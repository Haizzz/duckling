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
  priority?: string;
  issueType?: string;
  reporter?: string;
  labels?: string[];
  components?: string[];
  fixVersions?: string[];
  duedate?: string;
  additionalFields?: { [key: string]: any };
}

export interface JiraSearchResponse {
  issues: Array<{
    id: string;
    key: string;
    fields: {
      summary: string;
      description?: string;
      status: {
        name: string;
      };
      assignee?: {
        displayName: string;
        emailAddress: string;
      };
      created: string;
      updated: string;
      priority?: {
        name: string;
      };
      issuetype?: {
        name: string;
      };
      reporter?: {
        displayName: string;
        emailAddress: string;
      };
      labels?: string[];
      components?: Array<{
        name: string;
      }>;
      fixVersions?: Array<{
        name: string;
      }>;
      duedate?: string;
      [key: string]: any; // Allow for any additional custom fields
    };
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
            fields:
              'summary,description,status,assignee,created,updated,priority,issuetype,reporter,labels,components,fixVersions,duedate,*all',
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
            summary: issue.fields.summary,
            description: this.extractDescriptionText(issue.fields.description),
            status: issue.fields.status.name,
            assignee: issue.fields.assignee?.displayName,
            created: issue.fields.created,
            updated: issue.fields.updated,
            priority: issue.fields.priority?.name,
            issueType: issue.fields.issuetype?.name,
            reporter: issue.fields.reporter?.displayName,
            labels: issue.fields.labels || [],
            components: issue.fields.components?.map((c) => c.name) || [],
            fixVersions: issue.fields.fixVersions?.map((v) => v.name) || [],
            duedate: issue.fields.duedate,
            additionalFields: this.extractAdditionalFields(issue.fields),
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
   * Extract additional custom fields from Jira response
   * Excludes standard fields we already handle
   */
  private extractAdditionalFields(fields: any): { [key: string]: any } {
    const standardFields = new Set([
      'summary',
      'description',
      'status',
      'assignee',
      'created',
      'updated',
      'priority',
      'issuetype',
      'reporter',
      'labels',
      'components',
      'fixVersions',
      'duedate',
    ]);

    const additionalFields: { [key: string]: any } = {};

    for (const [key, value] of Object.entries(fields)) {
      if (
        !standardFields.has(key) &&
        value !== null &&
        value !== undefined &&
        value !== ''
      ) {
        // Skip empty arrays
        if (Array.isArray(value) && value.length === 0) {
          continue;
        }
        additionalFields[key] = value;
      }
    }

    return additionalFields;
  }

  /**
   * Format a comprehensive task description including all non-empty Jira fields
   */
  private formatTaskDescription(ticket: JiraTicket): string {
    let description = `Jira Ticket: ${ticket.key}\nSummary: ${ticket.summary}\n\n`;

    // Add description if present
    if (ticket.description) {
      description += `Description:\n${ticket.description}\n\n`;
    }

    // Add all non-empty standard fields
    const fields = [
      { label: 'Status', value: ticket.status },
      { label: 'Issue Type', value: ticket.issueType },
      { label: 'Priority', value: ticket.priority },
      { label: 'Assignee', value: ticket.assignee },
      { label: 'Reporter', value: ticket.reporter },
      { label: 'Due Date', value: ticket.duedate },
    ];

    const nonEmptyFields = fields.filter((field) => field.value);
    if (nonEmptyFields.length > 0) {
      description += 'Details:\n';
      nonEmptyFields.forEach((field) => {
        description += `• ${field.label}: ${field.value}\n`;
      });
      description += '\n';
    }

    // Add arrays if they have values
    if (ticket.labels && ticket.labels.length > 0) {
      description += `Labels: ${ticket.labels.join(', ')}\n`;
    }

    if (ticket.components && ticket.components.length > 0) {
      description += `Components: ${ticket.components.join(', ')}\n`;
    }

    if (ticket.fixVersions && ticket.fixVersions.length > 0) {
      description += `Fix Versions: ${ticket.fixVersions.join(', ')}\n`;
    }

    // Add custom fields if present
    if (
      ticket.additionalFields &&
      Object.keys(ticket.additionalFields).length > 0
    ) {
      description += '\nCustom Fields:\n';
      Object.entries(ticket.additionalFields).forEach(([key, value]) => {
        // Format the field name (remove customfield_ prefix and make readable)
        const fieldName = key.startsWith('customfield_')
          ? key.replace('customfield_', 'Custom Field ')
          : key.charAt(0).toUpperCase() + key.slice(1);

        let formattedValue = value;
        if (typeof value === 'object') {
          formattedValue = JSON.stringify(value);
        }

        description += `• ${fieldName}: ${formattedValue}\n`;
      });
    }

    // Add timestamps at the end
    description += `\nCreated: ${ticket.created}`;
    if (ticket.updated !== ticket.created) {
      description += `\nLast Updated: ${ticket.updated}`;
    }

    return description;
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
          description: this.formatTaskDescription(jiraTicket),
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
