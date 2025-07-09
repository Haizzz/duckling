/**
 * GitHub Provider Factory - Creates appropriate GitHub provider based on configuration
 */

import { GitHubProvider, GitHubProviderFactory } from './github-interface';
import { GitHubManager } from './github-manager';
import { GitHubCLIProvider } from './github-cli-provider';
import { DatabaseManager } from './database';
import { OpenAIManager } from './openai-manager';
import { SettingsManager } from './settings-manager';
import { isGitHubCLIAvailable } from '../utils/github-cli-utils';
import { logger } from '../utils/logger';

export class DefaultGitHubProviderFactory implements GitHubProviderFactory {
  private db: DatabaseManager;
  private openaiManager: OpenAIManager;
  private settings: SettingsManager;

  constructor(db: DatabaseManager, openaiManager: OpenAIManager) {
    this.db = db;
    this.openaiManager = openaiManager;
    this.settings = new SettingsManager(db);
  }

  async createProvider(): Promise<GitHubProvider> {
    // Check if GitHub CLI is available and preferred
    const cliAvailable = await isGitHubCLIAvailable();

    if (cliAvailable) {
      logger.info('Using GitHub CLI for GitHub operations');
      return new GitHubCLIProvider(this.db, this.openaiManager);
    }

    // Fall back to token-based GitHub API
    const githubToken = this.settings.get('githubToken');
    if (!githubToken) {
      throw new Error(
        'GitHub token not configured and GitHub CLI not available'
      );
    }

    logger.info('Using GitHub API token for GitHub operations');
    return new GitHubManager(githubToken, this.db, this.openaiManager);
  }
}

/**
 * Check if GitHub CLI should be used over token authentication
 */
export async function shouldUseGitHubCLI(): Promise<boolean> {
  return await isGitHubCLIAvailable();
}

/**
 * Get GitHub authentication status for display
 */
export async function getGitHubAuthStatus(): Promise<{
  method: 'cli' | 'token' | 'none';
  authenticated: boolean;
  username?: string;
}> {
  const cliAvailable = await isGitHubCLIAvailable();

  if (cliAvailable) {
    const { getGitHubCLIStatus } = await import('../utils/github-cli-utils');
    const status = await getGitHubCLIStatus();
    return {
      method: 'cli',
      authenticated: status.authenticated,
      username: status.username,
    };
  }

  const settings = new SettingsManager(new DatabaseManager());
  const githubToken = settings.get('githubToken');

  return {
    method: githubToken ? 'token' : 'none',
    authenticated: !!githubToken,
  };
}
