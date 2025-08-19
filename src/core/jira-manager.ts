import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import { SettingsManager } from './settings-manager';
import { DatabaseManager } from './database';
import { CreateTaskRequest } from '../types';
import { existsSync } from 'fs';

export interface JiraTicket {
  id: string;
  key: string;
  summary: string;
  description: string;
  status: string;
  assignee?: string;
  created: string;
  updated: string;
  allFields: Record<string, any>; // Store all available fields
}

export interface JiraSearchResponse {
  issues: Array<{
    id: string;
    key: string;
    fields: Record<string, any>; // Accept all fields dynamically
  }>;
  total: number;
}

export class JiraManager {
  private settings: SettingsManager;
  private db: DatabaseManager;

  constructor(settings: SettingsManager, db: DatabaseManager) {
    this.settings = settings;
    this.db = db;
  }

  /**
   * Early return if Jira is not properly configured
   */
  private isConfigured(): boolean {
    const apiKey = this.settings.get('jiraApiKey');
    const email = this.settings.get('jiraEmail');
    const jql = this.settings.get('jiraJqlQuery');
    const baseUrl = this.settings.get('jiraBaseUrl');
    const jiraRepository = this.settings.get('jiraRepository');

    if (!apiKey || !email || !jql || !baseUrl) {
      logger.info(
        'Jira integration not configured - missing API key, email, JQL query, or base URL'
      );
      return false;
    }

    if (!jiraRepository) {
      logger.info(
        'Jira integration not configured - missing jiraRepository setting'
      );
      return false;
    }

    if (!existsSync(jiraRepository)) {
      logger.error(
        `Jira integration not configured - repository path does not exist: ${jiraRepository}`
      );
      return false;
    }

    return true;
  }

  /**
   * Get the latest tickets from JQL query
   */
  async getLatestTickets(maxResults: number = 5): Promise<JiraTicket[]> {
    if (!this.isConfigured()) {
      return [];
    }

    const apiKey = this.settings.get('jiraApiKey');
    const email = this.settings.get('jiraEmail');
    const jql = this.settings.get('jiraJqlQuery');
    const baseUrl = this.settings.get('jiraBaseUrl');

    try {
      return await withRetry(
        async () => {
          const authString = Buffer.from(`${email}:${apiKey}`).toString(
            'base64'
          );
          const params = new URLSearchParams({
            jql: jql,
            maxResults: maxResults.toString(),
            startAt: '0',
            fields: '*all', // Fetch all available fields
          });

          const response = await fetch(
            `${baseUrl}/rest/api/3/search/jql?${params}`,
            {
              method: 'GET',
              headers: {
                Authorization: `Basic ${authString}`,
                Accept: 'application/json',
              },
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `Jira API error: ${response.status} ${response.statusText} - ${errorText}`
            );
          }

          const data = (await response.json()) as JiraSearchResponse;

          if (data.issues.length === 0) {
            logger.info('No tickets found matching the JQL query');
            return [];
          }

          const tickets: JiraTicket[] = data.issues.map((issue) => ({
            id: issue.id,
            key: issue.key,
            summary: issue.fields.summary || '',
            description: this.extractDescriptionText(issue.fields.description),
            status: issue.fields.status?.name || '',
            assignee: issue.fields.assignee?.displayName,
            created: issue.fields.created || '',
            updated: issue.fields.updated || '',
            allFields: issue.fields, // Store all fields for comprehensive formatting
          }));

          logger.info(
            `Retrieved ${tickets.length} Jira ticket(s): ${tickets.map((t) => t.key).join(', ')}`
          );
          return tickets;
        },
        'Jira API call',
        2
      );
    } catch (error) {
      logger.error(`Failed to fetch Jira tickets: ${error}`);
      return [];
    }
  }

  /**
   * Extract text content from Jira description field
   * Just JSON stringify it for now to see the structure
   */
  private extractDescriptionText(description: any): string {
    if (!description) {
      return '';
    }

    // If it's already a string, return it
    if (typeof description === 'string') {
      return description;
    }

    // For objects, just stringify to see the structure
    return JSON.stringify(description);
  }

  /**
   * Format all non-empty fields into a comprehensive task description
   */
  private formatAllFields(ticket: JiraTicket): string {
    const sections: string[] = [];

    // Start with the primary information
    sections.push(`**Jira Ticket: ${ticket.key}**`);
    sections.push(`**Summary:** ${ticket.summary}`);

    // Add description if present
    if (ticket.description.trim()) {
      sections.push(`**Description:**\n${ticket.description}`);
    }

    // Add core fields
    sections.push(`**Status:** ${ticket.status}`);

    if (ticket.assignee) {
      sections.push(`**Assignee:** ${ticket.assignee}`);
    }

    sections.push(`**Created:** ${new Date(ticket.created).toLocaleString()}`);
    sections.push(`**Updated:** ${new Date(ticket.updated).toLocaleString()}`);

    // Add all other non-empty fields
    const excludeFields = new Set([
      'summary',
      'description',
      'status',
      'assignee',
      'created',
      'updated',
      'id',
      'key',
      'self',
      'expand',
      'renderedFields',
      'names',
      'schema',
    ]);

    const additionalFields: string[] = [];

    for (const [fieldName, fieldValue] of Object.entries(ticket.allFields)) {
      if (excludeFields.has(fieldName)) {
        continue;
      }

      const formattedValue = this.formatFieldValue(fieldValue);
      if (formattedValue.trim()) {
        const displayName = this.getFieldDisplayName(fieldName);
        additionalFields.push(`**${displayName}:** ${formattedValue}`);
      }
    }

    if (additionalFields.length > 0) {
      sections.push(`\n**Additional Fields:**`);
      sections.push(...additionalFields);
    }

    return sections.join('\n\n');
  }

  /**
   * Format a field value for display
   */
  private formatFieldValue(value: any): string {
    if (!value) {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return '';
      }
      return value
        .map((item) => {
          if (typeof item === 'object' && item !== null) {
            return (
              item.name ||
              item.displayName ||
              item.value ||
              JSON.stringify(item)
            );
          }
          return String(item);
        })
        .join(', ');
    }

    if (typeof value === 'object' && value !== null) {
      // Handle common Jira object types
      if (value.name) {
        return value.name;
      }
      if (value.displayName) {
        return value.displayName;
      }
      if (value.value) {
        return value.value;
      }
      // For complex objects, provide a condensed representation
      const keys = Object.keys(value);
      if (keys.length <= 3) {
        return JSON.stringify(value);
      } else {
        return `Object with ${keys.length} properties`;
      }
    }

    return String(value);
  }

  /**
   * Get a human-readable display name for a field
   */
  private getFieldDisplayName(fieldName: string): string {
    const displayNameMap: Record<string, string> = {
      priority: 'Priority',
      reporter: 'Reporter',
      issuetype: 'Issue Type',
      project: 'Project',
      fixVersions: 'Fix Versions',
      affectedVersions: 'Affected Versions',
      components: 'Components',
      labels: 'Labels',
      environment: 'Environment',
      duedate: 'Due Date',
      resolution: 'Resolution',
      resolutiondate: 'Resolution Date',
      watches: 'Watchers',
      workratio: 'Work Ratio',
      timespent: 'Time Spent',
      timeoriginalestimate: 'Original Estimate',
      timeestimate: 'Remaining Estimate',
      aggregatetimespent: 'Total Time Spent',
      aggregatetimeoriginalestimate: 'Total Original Estimate',
      aggregatetimeestimate: 'Total Remaining Estimate',
    };

    // Check if it's a custom field
    if (fieldName.startsWith('customfield_')) {
      return `Custom Field (${fieldName})`;
    }

    return (
      displayNameMap[fieldName] ||
      fieldName.charAt(0).toUpperCase() + fieldName.slice(1)
    );
  }

  /**
   * Check if a task is created from a Jira ticket
   */
  isJiraTicket(task: { title: string; description: string }): boolean {
    return task.description.includes('Jira Ticket: ');
  }

  /**
   * Extract the Jira key from a task description
   */
  getJiraKey(task: { title: string; description: string }): string | null {
    // Look for "Jira Ticket: KEY" pattern in description
    const match = task.description.match(/Jira Ticket: ([A-Z]+-\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Get the latest tasks from Jira and create them as pending tasks if not already exists
   * Returns array of task IDs for newly created or existing tasks
   */
  async getLatestTasksForProcessing(
    createTaskCallback: (request: CreateTaskRequest) => Promise<number>
  ): Promise<number[]> {
    try {
      const jiraTickets = await this.getLatestTickets(5);
      if (jiraTickets.length === 0) {
        return [];
      }

      const taskIds: number[] = [];
      const existingTasks = this.db.getTasks({});
      // Repository path is already validated in isConfigured()
      const repositoryPath = this.settings.get('jiraRepository');

      logger.info(
        `Processing ${jiraTickets.length} Jira tickets for repository: ${repositoryPath}`
      );

      for (const jiraTicket of jiraTickets) {
        // Check if we already have a task for this Jira ticket
        const existingTask = existingTasks.find(
          (task) =>
            task.description.includes(jiraTicket.key) ||
            task.title.includes(jiraTicket.key)
        );

        if (existingTask) {
          logger.info(
            `Task already exists for Jira ticket ${jiraTicket.key}: Task ${existingTask.id}`
          );
          taskIds.push(existingTask.id);
          continue;
        }

        // Create a new task request from the Jira ticket
        const createTaskRequest: CreateTaskRequest = {
          title: `${jiraTicket.key}: ${jiraTicket.summary}`.slice(0, 100),
          description: this.formatAllFields(jiraTicket),
          codingTool: this.settings.get('defaultCodingTool'),
          repositoryPath,
        };

        // Create the task using the provided callback
        const taskId = await createTaskCallback(createTaskRequest);
        taskIds.push(taskId);

        logger.info(
          `Created task ${taskId} from Jira ticket ${jiraTicket.key}`
        );
      }

      logger.info(
        `Processed ${jiraTickets.length} Jira tickets, created/found ${taskIds.length} tasks`
      );
      return taskIds;
    } catch (error) {
      logger.error(`Failed to get latest tasks from Jira: ${error}`);
      return [];
    }
  }
}
