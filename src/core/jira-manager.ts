import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import { SettingsManager } from './settings-manager';

export interface JiraTicket {
  id: string;
  key: string;
  summary: string;
  description: string;
  status: string;
  assignee?: string;
  created: string;
  updated: string;
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
    };
  }>;
  total: number;
}

export class JiraManager {
  private settings: SettingsManager;
  private baseUrl = 'https://canva.atlassian.net';

  constructor(settings: SettingsManager) {
    this.settings = settings;
  }

  /**
   * Early return if Jira is not properly configured
   */
  private isConfigured(): boolean {
    const apiKey = this.settings.get('jiraApiKey');
    const jql = this.settings.get('jiraJqlQuery');

    if (!apiKey || !jql) {
      logger.info(
        'Jira integration not configured - missing API key or JQL query'
      );
      return false;
    }

    return true;
  }

  /**
   * Get the latest ticket from JQL query (1 ticket only)
   */
  async getLatestTicket(): Promise<JiraTicket | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const apiKey = this.settings.get('jiraApiKey');
    const jql = this.settings.get('jiraJqlQuery');

    try {
      return await withRetry(
        async () => {
          const response = await fetch(`${this.baseUrl}/rest/api/3/search`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              jql: jql,
              maxResults: 1,
              startAt: 0,
              fields: [
                'summary',
                'description',
                'status',
                'assignee',
                'created',
                'updated',
              ],
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `Jira API error: ${response.status} ${response.statusText} - ${errorText}`
            );
          }

          const data = (await response.json()) as JiraSearchResponse;

          if (data.issues.length === 0) {
            logger.info('No tickets found matching the JQL query');
            return null;
          }

          const issue = data.issues[0];
          const ticket: JiraTicket = {
            id: issue.id,
            key: issue.key,
            summary: issue.fields.summary,
            description: issue.fields.description || '',
            status: issue.fields.status.name,
            assignee: issue.fields.assignee?.displayName,
            created: issue.fields.created,
            updated: issue.fields.updated,
          };

          logger.info(
            `Retrieved Jira ticket: ${ticket.key} - ${ticket.summary}`
          );
          return ticket;
        },
        'Jira API call',
        2
      );
    } catch (error) {
      logger.error(`Failed to fetch Jira ticket: ${error}`);
      return null;
    }
  }

  /**
   * Test the Jira configuration by making a simple API call
   */
  async testConnection(): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    const apiKey = this.settings.get('jiraApiKey');

    try {
      const response = await fetch(`${this.baseUrl}/rest/api/3/myself`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      });

      return response.ok;
    } catch (error) {
      logger.error(`Jira connection test failed: ${error}`);
      return false;
    }
  }
}
