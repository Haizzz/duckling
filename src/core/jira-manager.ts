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

  constructor(settings: SettingsManager) {
    this.settings = settings;
  }

  /**
   * Early return if Jira is not properly configured
   */
  private isConfigured(): boolean {
    const apiKey = this.settings.get('jiraApiKey');
    const jql = this.settings.get('jiraJqlQuery');
    const baseUrl = this.settings.get('jiraBaseUrl');

    if (!apiKey || !jql || !baseUrl) {
      logger.info(
        'Jira integration not configured - missing API key, JQL query, or base URL'
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
    const baseUrl = this.settings.get('jiraBaseUrl');

    try {
      return await withRetry(
        async () => {
          const response = await fetch(`${baseUrl}/rest/api/3/search`, {
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
}
