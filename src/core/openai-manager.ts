import OpenAI from 'openai';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import {
  createPRDescriptionPrompt,
  createBranchNamePrompt,
  createPRTitlePrompt,
  createTaskSummaryPrompt,
  createCommitMessagePrompt,
} from './prompts';
import { DatabaseManager } from './database';
import { SettingsManager } from './settings-manager';

export class OpenAIManager {
  private db: DatabaseManager;
  private settings: SettingsManager;
  private openai: OpenAI | null = null;

  constructor(db: DatabaseManager, settings: SettingsManager) {
    this.db = db;
    this.settings = settings;
    this.initializeClient();
  }

  private initializeClient(): void {
    const apiKey = this.settings.get('openaiApiKey');
    if (apiKey) {
      this.openai = new OpenAI({
        apiKey: apiKey,
      });
    }
  }

  private async callOpenAI(prompt: string): Promise<string> {
    if (!this.openai) {
      throw new Error(
        'OpenAI client not initialized. Please configure OpenAI API key in settings.'
      );
    }

    return await withRetry(
      async () => {
        const response = await this.openai!.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        });

        const content = response.choices[0]?.message?.content?.trim();
        logger.info(content || 'No response from OpenAI');
        if (!content) {
          throw new Error('No response from OpenAI');
        }

        return content;
      },
      'OpenAI API call',
      2
    );
  }

  async generateBranchName(
    taskDescription: string,
    taskId?: number
  ): Promise<string> {
    const maxBranchNameLength = 50;

    if (taskId) {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: '🤖 Analyzing task description to generate branch name...',
      });
    }

    // Try to initialize client if not available but token exists
    if (!this.openai) {
      this.initializeClient();
    }

    if (!this.openai) {
      // Fallback to simple generation if OpenAI not available
      if (taskId) {
        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message:
            '⚠️ OpenAI not configured, using simple branch name generation',
        });
      }
      return this.generateSimpleBranchName(
        taskDescription,
        maxBranchNameLength
      );
    }

    try {
      const prompt = createBranchNamePrompt(
        taskDescription,
        maxBranchNameLength
      );

      const result = await this.callOpenAI(prompt);

      // Clean up the result to ensure it's a valid branch name
      const cleanBranchName = result
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, maxBranchNameLength);

      if (cleanBranchName.length > 0) {
        logger.info(
          `Generated branch name via OpenAI: ${cleanBranchName} (${cleanBranchName.length}/${maxBranchNameLength} chars)`
        );
        if (taskId) {
          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: `🎯 Generated AI branch name: '${cleanBranchName}' (${cleanBranchName.length}/${maxBranchNameLength} chars)`,
          });
        }
        return cleanBranchName;
      }
    } catch (error) {
      logger.warn(
        `Failed to generate branch name via OpenAI: ${error}. Using fallback.`
      );
      if (taskId) {
        this.db.addTaskLog({
          task_id: taskId,
          level: 'warn',
          message: `⚠️ AI branch name generation failed: ${error}. Using fallback method`,
        });
      }
    }

    // Fallback to simple generation
    return this.generateSimpleBranchName(taskDescription, maxBranchNameLength);
  }

  async generatePRTitle(taskDescription: string): Promise<string> {
    const prefix = this.settings.get('prTitlePrefix');

    if (!this.openai) {
      // Fallback to simple generation if OpenAI not available
      return `${prefix} ${taskDescription.substring(0, 50)}${taskDescription.length > 50 ? '...' : ''}`;
    }

    try {
      const prompt = createPRTitlePrompt(taskDescription);

      const result = await this.callOpenAI(prompt);

      // Clean up the result
      const cleanTitle = result.replace(/^["']|["']$/g, '').trim();
      const fullTitle = `${prefix} ${cleanTitle}`;

      if (fullTitle.length <= 100) {
        logger.info(`Generated PR title via OpenAI: ${fullTitle}`);
        return fullTitle;
      }
    } catch (error) {
      logger.warn(
        `Failed to generate PR title via OpenAI: ${error}. Using fallback.`
      );
    }

    // Fallback to simple generation
    return `${prefix} ${taskDescription.substring(0, 80 - prefix.length)}${taskDescription.length > 80 - prefix.length ? '...' : ''}`;
  }

  async generatePRDescription(
    taskDescription: string,
    branchName: string
  ): Promise<string> {
    if (!this.openai) {
      // Fallback to simple generation if OpenAI not available
      return this.generateSimplePRDescription(taskDescription, branchName);
    }

    try {
      const prompt = createPRDescriptionPrompt(taskDescription);

      const result = await this.callOpenAI(prompt);

      if (result.length > 0) {
        const description = result.trim();
        logger.info(`Generated PR description via OpenAI`);
        return description;
      }
    } catch (error) {
      logger.warn(
        `Failed to generate PR description via OpenAI: ${error}. Using fallback.`
      );
    }

    // Fallback to simple generation
    return this.generateSimplePRDescription(taskDescription, branchName);
  }

  async generateTaskSummary(taskDescription: string): Promise<string> {
    if (!this.openai) {
      // Fallback to simple generation if OpenAI not available
      return (
        taskDescription.substring(0, 80) +
        (taskDescription.length > 80 ? '...' : '')
      );
    }

    try {
      const prompt = createTaskSummaryPrompt(taskDescription);

      const result = await this.callOpenAI(prompt);

      // Clean up the result
      const cleanSummary = result.replace(/^["']|["']$/g, '').trim();

      if (cleanSummary.length > 0 && cleanSummary.length <= 80) {
        logger.info(`Generated task summary via OpenAI: ${cleanSummary}`);
        return cleanSummary;
      }
    } catch (error) {
      logger.warn(
        `Failed to generate task summary via OpenAI: ${error}. Using fallback.`
      );
    }

    // Fallback to simple generation
    return (
      taskDescription.substring(0, 80) +
      (taskDescription.length > 80 ? '...' : '')
    );
  }

  async generateCommitMessage(
    taskDescription: string,
    changes: string[],
    taskId?: number
  ): Promise<string> {
    if (taskId) {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🤖 Analyzing ${changes.length} changed files to generate commit message...`,
      });
    }

    if (!this.openai) {
      // Fallback to simple generation if OpenAI not available
      if (taskId) {
        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message:
            '⚠️ OpenAI not configured, using simple commit message generation',
        });
      }
      return `${taskDescription.substring(0, 50)}${taskDescription.length > 50 ? '...' : ''}`;
    }

    try {
      const prompt = createCommitMessagePrompt(taskDescription, changes);

      const result = await this.callOpenAI(prompt);

      // Clean up the result
      const cleanMessage = result
        .replace(/^["']|["']$/g, '')
        .replace(/\.$/, '')
        .trim();

      if (cleanMessage.length > 0 && cleanMessage.length <= 50) {
        logger.info(`Generated commit message via OpenAI: ${cleanMessage}`);
        if (taskId) {
          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: `✅ Generated AI commit message: "${cleanMessage}"`,
          });
        }
        return cleanMessage;
      }
    } catch (error) {
      logger.warn(
        `Failed to generate commit message via OpenAI: ${error}. Using fallback.`
      );
      if (taskId) {
        this.db.addTaskLog({
          task_id: taskId,
          level: 'warn',
          message: `⚠️ AI commit message generation failed: ${error}. Using fallback method`,
        });
      }
    }

    // Fallback to simple generation
    const fallbackMessage = `${taskDescription.substring(0, 50)}${taskDescription.length > 50 ? '...' : ''}`;
    if (taskId) {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `📝 Using fallback commit message: "${fallbackMessage}"`,
      });
    }
    return fallbackMessage;
  }

  // Fallback methods for when OpenAI is not available
  private generateSimpleBranchName(
    description: string,
    maxLength: number = 30
  ): string {
    return description
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join('-')
      .substring(0, maxLength);
  }

  private generateSimplePRDescription(
    taskDescription: string,
    branchName: string
  ): string {
    return `## Summary

${taskDescription}

## Branch
\`${branchName}\``;
  }

  // Method to refresh the OpenAI client when settings change
  refreshClient(): void {
    this.initializeClient();
  }
}
