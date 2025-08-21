/**
 * GitHub API Provider - Implements GitHub operations using GitHub REST API directly
 * Supports GitHub Apps authentication instead of CLI
 */

import { validateAndGetRepoInfo } from '../utils/git-utils';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';
import { execCommand } from '../utils/exec';
import { processAllComments, CommentData } from '../utils/comment-processor';
import { DatabaseManager } from './database';
import { OpenAIManager } from './openai-manager';
import { SettingsManager } from './settings-manager';
import { JiraManager } from './jira-manager';
import { Task } from '../types';
import { createSign } from 'crypto';

interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  installationId: string;
}

interface GitHubAPIResponse<T = any> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

interface GitHubRepository {
  default_branch: string;
  name: string;
  full_name: string;
}

interface GitHubPullRequest {
  number: number;
  html_url: string;
  state: string;
  merged: boolean;
  mergeable: boolean | null;
  title: string;
  body: string;
  user: { login: string };
  created_at: string;
}

export class GitHubAPIProvider {
  private db: DatabaseManager;
  private openaiManager: OpenAIManager;
  private settings: SettingsManager;
  private jiraManager: JiraManager;
  private repoOwner: string = '';
  private repoName: string = '';
  private currentRepoPath: string = '';
  private appConfig?: GitHubAppConfig;
  private accessToken?: string;
  private tokenExpiresAt?: Date;

  constructor(
    db: DatabaseManager,
    openaiManager: OpenAIManager,
    settings: SettingsManager,
    jiraManager: JiraManager,
    appConfig?: GitHubAppConfig
  ) {
    this.db = db;
    this.openaiManager = openaiManager;
    this.settings = settings;
    this.jiraManager = jiraManager;
    this.appConfig = appConfig;
  }

  private async ensureInitialized(repositoryPath: string) {
    // Re-initialize if repository path has changed
    if (this.currentRepoPath === repositoryPath) return;

    try {
      const repoInfo = await validateAndGetRepoInfo(repositoryPath);
      this.repoOwner = repoInfo.owner;
      this.repoName = repoInfo.name;
      this.currentRepoPath = repositoryPath;
    } catch (error) {
      throw new Error(`Failed to get repository information: ${error}`);
    }
  }

  private async getAccessToken(): Promise<string> {
    if (!this.appConfig) {
      throw new Error('GitHub App configuration not provided');
    }

    // Return cached token if still valid
    if (
      this.accessToken &&
      this.tokenExpiresAt &&
      new Date() < this.tokenExpiresAt
    ) {
      return this.accessToken;
    }

    // Generate JWT for GitHub App authentication
    const jwt = this.generateJWT();

    // Get installation access token
    const response = await this.makeAPIRequest(
      `https://api.github.com/app/installations/${this.appConfig.installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    const tokenData = response.data as { token: string; expires_at: string };
    this.accessToken = tokenData.token;
    this.tokenExpiresAt = new Date(tokenData.expires_at);
    return this.accessToken;
  }

  private generateJWT(): string {
    if (!this.appConfig) {
      throw new Error('GitHub App configuration not provided');
    }

    const header = {
      alg: 'RS256',
      typ: 'JWT',
    };

    const payload = {
      iat: Math.floor(Date.now() / 1000) - 60, // Issued 60 seconds ago
      exp: Math.floor(Date.now() / 1000) + 10 * 60, // Expires in 10 minutes
      iss: this.appConfig.appId,
    };

    // Base64URL encode header and payload
    const encodedHeader = this.base64URLEscape(
      Buffer.from(JSON.stringify(header)).toString('base64')
    );
    const encodedPayload = this.base64URLEscape(
      Buffer.from(JSON.stringify(payload)).toString('base64')
    );

    // Create signature
    const data = `${encodedHeader}.${encodedPayload}`;
    const sign = createSign('RSA-SHA256');
    sign.update(data);
    const signature = sign.sign(this.appConfig.privateKey, 'base64');
    const encodedSignature = this.base64URLEscape(signature);

    return `${data}.${encodedSignature}`;
  }

  private base64URLEscape(str: string): string {
    return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  private async makeAPIRequest<T = any>(
    url: string,
    options: RequestInit = {}
  ): Promise<GitHubAPIResponse<T>> {
    const token = await this.getAccessToken();

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Duckling-GitHub-API-Provider',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `GitHub API request failed: ${response.status} ${response.statusText} - ${errorBody}`
      );
    }

    const data = (await response.json()) as T;
    return {
      data,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
    };
  }

  async getDefaultBranch(repositoryPath: string): Promise<string> {
    await this.ensureInitialized(repositoryPath);

    return await withRetry(async () => {
      try {
        const response = await this.makeAPIRequest<GitHubRepository>(
          `https://api.github.com/repos/${this.repoOwner}/${this.repoName}`
        );
        return response.data.default_branch;
      } catch (error) {
        logger.warn(
          'Could not get default branch from GitHub API, falling back to "main"',
          String(error)
        );
        return 'main';
      }
    }, 'Get default branch from GitHub API');
  }

  async createPRFromTask(
    branchName: string,
    task: Task,
    repositoryPath: string
  ): Promise<{ number: number; url: string }> {
    await this.ensureInitialized(repositoryPath);

    this.db.addTaskLog({
      task_id: task.id,
      level: 'info',
      message: '🤖 Generating PR title and description...',
    });

    // Get recent PRs as examples
    const recentPRs = await this.getRecentUserPRs(repositoryPath);

    // Get current PR diff for context
    const prDiff = await this.getBranchDiff(branchName, repositoryPath);

    // Generate intelligent title and description using OpenAI with examples
    const title = await this.openaiManager.generatePRTitle(
      task,
      recentPRs,
      prDiff,
      this.jiraManager
    );
    const description = await this.openaiManager.generatePRDescription(
      task.description,
      branchName,
      recentPRs,
      prDiff
    );

    this.db.addTaskLog({
      task_id: task.id,
      level: 'info',
      message: `📋 Generated PR title: "${title}"`,
    });

    return this.createPR(
      branchName,
      title,
      description,
      task.id,
      repositoryPath
    );
  }

  async createPR(
    branchName: string,
    title: string,
    description: string,
    taskId: number,
    repositoryPath: string
  ): Promise<{ number: number; url: string }> {
    await this.ensureInitialized(repositoryPath);

    return await withRetry(
      async () => {
        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: `🔍 Checking if PR already exists for branch: ${branchName}`,
        });

        // Check if PR already exists for this branch
        const existingPR = await this.findPRByBranch(
          branchName,
          repositoryPath
        );
        if (existingPR) {
          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: `✅ Found existing PR #${existingPR.number}: ${existingPR.url}`,
          });
          return {
            number: existingPR.number,
            url: existingPR.html_url,
          };
        }

        // Get the default branch
        const defaultBranch = await this.getDefaultBranch(repositoryPath);

        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: `🚀 Creating new PR from ${branchName} to ${defaultBranch}...`,
        });

        // Create new PR using GitHub API
        const response = await this.makeAPIRequest<GitHubPullRequest>(
          `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/pulls`,
          {
            method: 'POST',
            body: JSON.stringify({
              title,
              body: description,
              head: branchName,
              base: defaultBranch,
            }),
          }
        );

        const prNumber = response.data.number;
        const prUrl = response.data.html_url;

        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: `✅ PR created successfully: #${prNumber} - ${prUrl}`,
        });

        this.logPREvent(taskId, `PR created: #${prNumber}`);

        return {
          number: prNumber,
          url: prUrl,
        };
      },
      'Create PR via GitHub API',
      3
    );
  }

  async findPRByBranch(
    branchName: string,
    repositoryPath?: string
  ): Promise<any> {
    if (repositoryPath) {
      await this.ensureInitialized(repositoryPath);
    }

    try {
      const response = await this.makeAPIRequest<GitHubPullRequest[]>(
        `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/pulls?head=${this.repoOwner}:${branchName}&state=open`
      );

      return response.data.length > 0 ? response.data[0] : null;
    } catch (error) {
      logger.debug('Failed to find PR by branch:', String(error));
      return null;
    }
  }

  async pollForComments(
    prNumber: number,
    lastCommitTimestamp: string | null,
    repositoryPath: string
  ): Promise<string[]> {
    try {
      const commentPrefix = this.settings.get('commentPrefix');

      // Get current user to filter out their own comments
      const currentUser = await this.getCurrentUser(repositoryPath);

      // Get all comment types (reviews, review comments, and PR comments)
      const { reviewComments, prComments } = await this.getAllCommentsSeparated(
        prNumber,
        repositoryPath
      );

      // Convert to common format
      const prCommentData: CommentData[] = prComments.map((comment: any) => ({
        user: { login: comment.user.login },
        body: comment.body,
        created_at: comment.created_at,
      }));

      const reviewCommentData: CommentData[] = reviewComments.map(
        (comment: any) => ({
          user: { login: comment.user.login },
          body: comment.body,
          created_at: comment.created_at,
          state: comment.state,
          path: comment.path,
          line: comment.line,
          diff_hunk: comment.diff_hunk,
        })
      );

      return processAllComments(prCommentData, reviewCommentData, {
        commentPrefix,
        lastCommitTimestamp,
        currentUser,
      });
    } catch (error) {
      logger.error(
        'Failed to fetch PR comments via GitHub API:',
        String(error)
      );
      return [];
    }
  }

  async getPRReviews(prNumber: number, repositoryPath: string): Promise<any[]> {
    return await withRetry(
      async () => {
        await this.ensureInitialized(repositoryPath);

        const response = await this.makeAPIRequest(
          `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}/reviews`
        );

        return response.data;
      },
      'Get PR reviews via GitHub API',
      2
    );
  }

  async getAllCommentsSeparated(
    prNumber: number,
    repositoryPath: string
  ): Promise<{ reviewComments: any[]; prComments: any[] }> {
    await this.ensureInitialized(repositoryPath);
    const reviewComments = [];
    const prComments = [];

    // 1. Get PR reviews (review bodies)
    const reviews = await this.getPRReviews(prNumber, repositoryPath);

    // Filter out pending reviews and process only submitted ones
    const submittedReviews = reviews.filter(
      (review) => review.state !== 'PENDING'
    );

    if (reviews.length > submittedReviews.length) {
      logger.info(
        `Filtered out ${reviews.length - submittedReviews.length} pending review(s)`
      );
    }

    // Add review body comments and get their associated review comments
    for (const review of submittedReviews) {
      // Add the review body comment
      if (review.body && review.body.trim()) {
        reviewComments.push({
          user: { login: review.user.login },
          body: review.body,
          created_at: review.submitted_at,
          state: review.state,
        });
      }

      if (review.id) {
        // 2. Get all review comments (line-by-line comments attached to reviews)
        const reviewCommentsResponse = await this.makeAPIRequest(
          `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}/reviews/${review.id}/comments`
        );

        const reviewLineComments = reviewCommentsResponse.data;
        reviewComments.push(
          ...reviewLineComments.map((comment: any) => ({
            user: { login: comment.user.login },
            body: comment.body,
            created_at: comment.created_at,
            path: comment.path,
            line: comment.line,
            diff_hunk: comment.diff_hunk,
          }))
        );
      }
    }

    // 3. Get individual PR comments (not attached to reviews)
    const prCommentsResponse = await this.makeAPIRequest(
      `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/issues/${prNumber}/comments`
    );

    const prCommentsData = prCommentsResponse.data;
    prComments.push(
      ...prCommentsData.map((comment: any) => ({
        user: { login: comment.user.login },
        body: comment.body,
        created_at: comment.created_at,
      }))
    );

    return { reviewComments, prComments };
  }

  async getAllReviewComments(
    prNumber: number,
    repositoryPath: string
  ): Promise<any[]> {
    const { reviewComments, prComments } = await this.getAllCommentsSeparated(
      prNumber,
      repositoryPath
    );
    return [...reviewComments, ...prComments];
  }

  async getCurrentUser(repositoryPath: string): Promise<string | null> {
    await this.ensureInitialized(repositoryPath);

    return await withRetry(
      async () => {
        try {
          const response = await this.makeAPIRequest(
            'https://api.github.com/user'
          );
          return response.data.login;
        } catch (error) {
          logger.warn(
            'Could not get current user from GitHub API:',
            String(error)
          );
          return null;
        }
      },
      'Get current user from GitHub API',
      2
    );
  }

  async getPRStatus(
    prNumber: number,
    repositoryPath: string
  ): Promise<{
    state: string;
    mergeable: boolean | null;
    merged: boolean;
  }> {
    await this.ensureInitialized(repositoryPath);

    return await withRetry(
      async () => {
        const response = await this.makeAPIRequest(
          `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}`
        );

        const data = response.data;
        return {
          state: data.state || 'UNKNOWN',
          mergeable: data.mergeable,
          merged: data.merged,
        };
      },
      'Get PR status via GitHub API',
      2
    );
  }

  async getRecentUserPRs(
    repositoryPath: string
  ): Promise<Array<{ title: string; body: string; diff?: string }>> {
    await this.ensureInitialized(repositoryPath);

    try {
      const prTitlePrefix = this.settings.get('prTitlePrefix');

      // Get current user
      const currentUser = await this.getCurrentUser(repositoryPath);
      if (!currentUser) {
        logger.warn('Could not get current user for filtering PRs');
        return [];
      }

      // Get recent PRs by the current user
      const response = await this.makeAPIRequest(
        `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/pulls?state=all&sort=created&direction=desc&per_page=10&creator=${currentUser}`
      );

      // Filter out PRs created by this tool (those with the prefix)
      const allPRs = response.data;
      const recentPRs = allPRs.filter(
        (pr: any) => !pr.title.startsWith(prTitlePrefix)
      );

      // For each PR, try to get the diff as well
      const prsWithDiff = await Promise.all(
        recentPRs.slice(0, 5).map(async (pr: any) => {
          try {
            // Get diff using direct API call with proper headers
            const token = await this.getAccessToken();
            const response = await fetch(
              `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/pulls/${pr.number}`,
              {
                headers: {
                  Authorization: `token ${token}`,
                  Accept: 'application/vnd.github.v3.diff',
                  'User-Agent': 'Duckling-GitHub-API-Provider',
                },
              }
            );

            const diff = response.ok ? await response.text() : undefined;

            return {
              title: pr.title,
              body: pr.body || '',
              diff,
            };
          } catch (error) {
            return {
              title: pr.title,
              body: pr.body || '',
            };
          }
        })
      );

      logger.info(
        `Found ${prsWithDiff.length} recent user PRs as examples (excluding tool-generated PRs)`
      );
      return prsWithDiff;
    } catch (error) {
      logger.warn(`Failed to fetch recent PRs: ${error}`);
      return [];
    }
  }

  async getBranchDiff(
    branchName: string,
    repositoryPath: string
  ): Promise<string> {
    await this.ensureInitialized(repositoryPath);

    try {
      const defaultBranch = await this.getDefaultBranch(repositoryPath);

      const result = await execCommand(
        'git',
        ['diff', `${defaultBranch}...${branchName}`],
        { cwd: repositoryPath }
      );

      if (result.exitCode !== 0) {
        logger.warn(`Could not get branch diff: ${result.stderr}`);
        return '';
      }

      return result.stdout;
    } catch (error) {
      logger.warn(`Failed to get branch diff: ${error}`);
      return '';
    }
  }

  private logPREvent(taskId: number, message: string): void {
    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message,
    });
  }
}
