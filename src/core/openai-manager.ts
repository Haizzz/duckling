import OpenAI from 'openai';
import { logger } from '../utils/logger';
import { DatabaseManager } from './database';
import { withRetry } from '../utils/retry';

export class OpenAIManager {
  private db: DatabaseManager;
  private openai: OpenAI | null = null;

  constructor(db: DatabaseManager) {
    this.db = db;
    this.initializeClient();
  }

  private initializeClient(): void {
    const apiKey = this.db.getSetting('openaiApiKey');
    if (apiKey && apiKey.value) {
      this.openai = new OpenAI({
        apiKey: apiKey.value
      });
    }
  }

  private async callOpenAI(prompt: string): Promise<string> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized. Please configure OpenAI API key in settings.');
    }

    return await withRetry(async () => {
      const response = await this.openai!.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
      });

      const content = response.choices[0]?.message?.content?.trim();
      logger.info(content || 'No response from OpenAI');
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      return content;
    }, 'OpenAI API call', 2);
  }

  async generateBranchName(taskDescription: string): Promise<string> {
    // Get branch prefix to calculate available space
    const prefixSetting = this.db.getSetting('branchPrefix');
    const branchPrefix = prefixSetting?.value || 'duckling/';
    const maxBranchNameLength = 30 - branchPrefix.length; // Reserve space for prefix

    if (!this.openai) {
      // Fallback to simple generation if OpenAI not available
      return this.generateSimpleBranchName(taskDescription, maxBranchNameLength);
    }

    try {
      const prompt = `Generate a short, descriptive Git branch name (kebab-case, max ${maxBranchNameLength} chars) for this task: "${taskDescription}". 
Rules:
- Use only lowercase letters, numbers, and hyphens
- Start with a letter
- Be descriptive but concise
- No special characters or spaces
- Maximum ${maxBranchNameLength} characters (prefix will be added separately)
- Examples: "fix-login-bug", "add-user-auth", "update-navbar-styles"

Branch name:`;

      const result = await this.callOpenAI(prompt);

      // Clean up the result to ensure it's a valid branch name
      const cleanBranchName = result
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, maxBranchNameLength);

      if (cleanBranchName.length > 0) {
        logger.info(`Generated branch name via OpenAI: ${cleanBranchName} (${cleanBranchName.length}/${maxBranchNameLength} chars)`);
        return cleanBranchName;
      }
    } catch (error) {
      logger.warn(`Failed to generate branch name via OpenAI: ${error}. Using fallback.`);
    }

    // Fallback to simple generation
    return this.generateSimpleBranchName(taskDescription, maxBranchNameLength);
  }

  async generatePRTitle(taskDescription: string, branchName: string): Promise<string> {
    const prefix = this.db.getSetting('prTitlePrefix')?.value || '[DUCKLING]';

    if (!this.openai) {
      // Fallback to simple generation if OpenAI not available
      return `${prefix} ${taskDescription.substring(0, 50)}${taskDescription.length > 50 ? '...' : ''}`;
    }

    try {
      const prompt = `Generate a clear, professional pull request title for this task: "${taskDescription}".
Rules:
- Maximum 80 characters total (including prefix)
- Use imperative mood (e.g., "Add", "Fix", "Update")
- Be specific and descriptive
- No prefix needed (will be added automatically)
- Examples: "Fix authentication bug in login flow", "Add user profile settings page"

PR title:`;

      const result = await this.callOpenAI(prompt);

      // Clean up the result
      const cleanTitle = result.replace(/^["']|["']$/g, '').trim();
      const fullTitle = `${prefix} ${cleanTitle}`;

      if (fullTitle.length <= 100) {
        logger.info(`Generated PR title via OpenAI: ${fullTitle}`);
        return fullTitle;
      }
    } catch (error) {
      logger.warn(`Failed to generate PR title via OpenAI: ${error}. Using fallback.`);
    }

    // Fallback to simple generation
    return `${prefix} ${taskDescription.substring(0, 80 - prefix.length)}${taskDescription.length > (80 - prefix.length) ? '...' : ''}`;
  }

  async generatePRDescription(taskDescription: string, branchName: string): Promise<string> {
    if (!this.openai) {
      // Fallback to simple generation if OpenAI not available
      return this.generateSimplePRDescription(taskDescription, branchName);
    }

    try {
      const prompt = `Generate a professional pull request description for this task: "${taskDescription}".
Include:
- Brief summary of changes
- Why this change was needed
- Any relevant details for reviewers

Keep it concise but informative. Use plain text, no markdown formatting.

PR description:`;

      const result = await this.callOpenAI(prompt);

      if (result.length > 0) {
        const description = result.trim();
        logger.info(`Generated PR description via OpenAI`);
        return description;
      }
    } catch (error) {
      logger.warn(`Failed to generate PR description via OpenAI: ${error}. Using fallback.`);
    }

    // Fallback to simple generation
    return this.generateSimplePRDescription(taskDescription, branchName);
  }

  async generateTaskSummary(taskDescription: string): Promise<string> {
    if (!this.openai) {
      // Fallback to simple generation if OpenAI not available
      return taskDescription.substring(0, 80) + (taskDescription.length > 80 ? '...' : '');
    }

    try {
      const prompt = `Generate a concise summary for this development task: "${taskDescription}".
Rules:
- Maximum 80 characters
- Capture the main action and purpose
- Use active voice and be specific
- Examples: "Fix user authentication bug in login flow", "Add responsive design to homepage"

Summary:`;

      const result = await this.callOpenAI(prompt);

      // Clean up the result
      const cleanSummary = result.replace(/^["']|["']$/g, '').trim();

      if (cleanSummary.length > 0 && cleanSummary.length <= 80) {
        logger.info(`Generated task summary via OpenAI: ${cleanSummary}`);
        return cleanSummary;
      }
    } catch (error) {
      logger.warn(`Failed to generate task summary via OpenAI: ${error}. Using fallback.`);
    }

    // Fallback to simple generation
    return taskDescription.substring(0, 80) + (taskDescription.length > 80 ? '...' : '');
  }

  async generateCommitMessage(taskDescription: string, changes: string[]): Promise<string> {
    if (!this.openai) {
      // Fallback to simple generation if OpenAI not available
      return `${taskDescription.substring(0, 50)}${taskDescription.length > 50 ? '...' : ''}`;
    }

    try {
      const changesText = changes.length > 0 ? `\nFiles changed: ${changes.slice(0, 5).join(', ')}` : '';

      const prompt = `Generate a concise git commit message for this task: "${taskDescription}".${changesText}
Rules:
- Maximum 50 characters
- Use imperative mood (e.g., "Fix", "Add", "Update")
- No period at the end
- Be specific but concise
- Examples: "Fix login validation error", "Add user profile component"

Commit message:`;

      const result = await this.callOpenAI(prompt);

      // Clean up the result
      const cleanMessage = result.replace(/^["']|["']$/g, '').replace(/\.$/, '').trim();

      if (cleanMessage.length > 0 && cleanMessage.length <= 50) {
        logger.info(`Generated commit message via OpenAI: ${cleanMessage}`);
        return cleanMessage;
      }
    } catch (error) {
      logger.warn(`Failed to generate commit message via OpenAI: ${error}. Using fallback.`);
    }

    // Fallback to simple generation
    return `${taskDescription.substring(0, 50)}${taskDescription.length > 50 ? '...' : ''}`;
  }

  // Fallback methods for when OpenAI is not available
  private generateSimpleBranchName(description: string, maxLength: number = 30): string {
    return description
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join('-')
      .substring(0, maxLength);
  }

  private generateSimplePRDescription(taskDescription: string, branchName: string): string {
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
