import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import { SettingsManager } from './settings-manager';
import { DatabaseManager } from './database';
import { CreateTaskRequest } from '../types';
import { existsSync } from 'fs';

export interface JiraTicket {
  id: string;
  key: string;
  allFields: Record<string, any>;
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
            fields: '*all',
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
            allFields: issue.fields,
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
   * Format all non-empty fields in a readable format
   */
  private formatAllFields(ticket: JiraTicket): string {
    const lines = [`**Jira Ticket: ${ticket.key}**\n`];

    // Filter out empty/null values and format key-value pairs
    const nonEmptyFields = Object.entries(ticket.allFields).filter(
      ([, value]) => {
        if (value === null || value === undefined || value === '') return false;
        if (Array.isArray(value) && value.length === 0) return false;
        if (
          typeof value === 'object' &&
          value !== null &&
          Object.keys(value).length === 0
        )
          return false;
        return true;
      }
    );

    for (const [key, value] of nonEmptyFields) {
      let formattedValue: string;

      if (typeof value === 'string') {
        formattedValue = value;
      } else if (Array.isArray(value)) {
        formattedValue = value
          .map((item) =>
            typeof item === 'object' && item !== null && item.displayName
              ? item.displayName
              : typeof item === 'object' && item !== null && item.name
                ? item.name
                : JSON.stringify(item)
          )
          .join(', ');
      } else if (typeof value === 'object' && value !== null) {
        // Extract displayName or name for common Jira objects
        if (value.displayName) {
          formattedValue = value.displayName;
        } else if (value.name) {
          formattedValue = value.name;
        } else {
          formattedValue = JSON.stringify(value);
        }
      } else {
        formattedValue = String(value);
      }

      lines.push(`**${key}**: ${formattedValue}\n`);
    }

    return lines.join('\n');
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
        const summary = jiraTicket.allFields.summary || 'No Summary';
        const createTaskRequest: CreateTaskRequest = {
          title: `${jiraTicket.key}: ${summary}`.slice(0, 100),
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
