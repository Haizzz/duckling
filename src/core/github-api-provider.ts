/**
 * GitHub API Provider - Implements GitHub operations using GitHub Apps API
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

interface GitHubAppConfig {
  appId: string;
  installationId: string;
  privateKey: string; // PEM format private key
}

interface GitHubAPIResponse<T = any> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

export class GitHubAPIProvider {
  private db: DatabaseManager;
  private openaiManager: OpenAIManager;
  private settings: SettingsManager;
  private jiraManager: JiraManager;
  private repoOwner: string = '';
  private repoName: string = '';
  private currentRepoPath: string = '';
  private appConfig: GitHubAppConfig;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(
    db: DatabaseManager,
    openaiManager: OpenAIManager,
    settings: SettingsManager,
    jiraManager: JiraManager,
    appConfig: GitHubAppConfig
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

  private async generateJWT(): Promise<string> {
    // GitHub App JWT generation using crypto
    const crypto = await import('crypto');

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 10, // Issued 10 seconds in the past to allow for clock drift
      exp: now + 60 * 10, // JWT expires in 10 minutes
      iss: this.appConfig.appId,
    };

    const header = {
      alg: 'RS256',
      typ: 'JWT',
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
      'base64url'
    );
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url'
    );

    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const signature = crypto
      .createSign('RSA-SHA256')
      .update(signingInput)
      .sign(this.appConfig.privateKey, 'base64url');

    return `${signingInput}.${signature}`;
  }

  private async getAccessToken(): Promise<string> {
    // Check if we have a valid token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    // Generate new installation access token
    const jwt = await this.generateJWT();

    const response = await this.makeAPIRequest<{
      token: string;
      expires_at: string;
    }>(
      `https://api.github.com/app/installations/${this.appConfig.installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Duckling-GitHub-App/1.0',
        },
      }
    );

    if (response.status !== 201) {
      throw new Error(
        `Failed to get installation access token: ${response.status}`
      );
    }

    this.accessToken = response.data.token;
    // Token typically expires in 1 hour, we'll refresh 5 minutes early
    this.tokenExpiry = Date.now() + 55 * 60 * 1000;

    return this.accessToken;
  }

  private async makeAPIRequest<T = any>(
    url: string,
    options: RequestInit = {}
  ): Promise<GitHubAPIResponse<T>> {
    // For JWT generation, we don't want to call getAccessToken recursively
    const isJWTRequest = url.includes('/access_tokens');
    let token = '';

    if (!isJWTRequest) {
      token = await this.getAccessToken();
    }

    const defaultHeaders = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Duckling-GitHub-App/1.0',
      'Content-Type': 'application/json',
    };

    if (!isJWTRequest) {
      (defaultHeaders as any)['Authorization'] = `token ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    });

    let data: T;
    try {
      data = (await response.json()) as T;
    } catch (error) {
      data = (await response.text()) as T;
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      data,
      status: response.status,
      headers,
    };
  }

  async getDefaultBranch(repositoryPath: string): Promise<string> {
    await this.ensureInitialized(repositoryPath);

    return await withRetry(async () => {
      try {
        const response = await this.makeAPIRequest(
          `https://api.github.com/repos/${this.repoOwner}/${this.repoName}`
        );

        if (response.status !== 200) {
          throw new Error(`GitHub API request failed: ${response.status}`);
        }

        return response.data.default_branch || 'main';
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
            url: existingPR.url,
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
        const response = await this.makeAPIRequest(
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

        if (response.status !== 201) {
          throw new Error(
            `GitHub API request failed: ${response.status} - ${JSON.stringify(response.data)}`
          );
        }

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
      const response = await this.makeAPIRequest(
        `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/pulls?head=${this.repoOwner}:${branchName}&state=open`
      );

      if (response.status !== 200) {
        throw new Error(`GitHub API request failed: ${response.status}`);
      }

      const prs = response.data;
      return prs.length > 0
        ? {
            number: prs[0].number,
            url: prs[0].html_url,
            title: prs[0].title,
          }
        : null;
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
        user: comment.user,
        body: comment.body,
        created_at: comment.created_at,
      }));

      const reviewCommentData: CommentData[] = reviewComments.map(
        (comment: any) => ({
          user: comment.user,
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

        if (response.status !== 200) {
          throw new Error(`GitHub API request failed: ${response.status}`);
        }

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

        if (reviewCommentsResponse.status === 200) {
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
    }

    // 3. Get individual PR comments (not attached to reviews)
    const prCommentsResponse = await this.makeAPIRequest(
      `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/issues/${prNumber}/comments`
    );

    if (prCommentsResponse.status === 200) {
      const prCommentsData = prCommentsResponse.data;
      prComments.push(
        ...prCommentsData.map((comment: any) => ({
          user: { login: comment.user.login },
          body: comment.body,
          created_at: comment.created_at,
        }))
      );
    }

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

          if (response.status !== 200) {
            throw new Error(`GitHub API request failed: ${response.status}`);
          }

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

        if (response.status !== 200) {
          throw new Error(`GitHub API request failed: ${response.status}`);
        }

        const data = response.data;
        return {
          state: data.state || 'UNKNOWN',
          mergeable:
            data.mergeable === true
              ? true
              : data.mergeable === false
                ? false
                : null,
          merged: data.merged_at !== null && data.merged_at !== undefined,
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

      // Get recent PRs using GraphQL API
      const graphqlQuery = `
        query { 
          viewer { 
            pullRequests(first: 5, states: [OPEN, CLOSED, MERGED], orderBy: {field: CREATED_AT, direction: DESC}) { 
              nodes { 
                number 
                title 
                body 
                author { 
                  login 
                } 
              } 
            } 
          } 
        }`;

      const response = await this.makeAPIRequest(
        'https://api.github.com/graphql',
        {
          method: 'POST',
          body: JSON.stringify({ query: graphqlQuery }),
        }
      );

      if (response.status !== 200) {
        logger.warn(`Could not fetch recent PRs: ${response.status}`);
        return [];
      }

      // Filter out PRs created by this tool (those with the prefix)
      const allPRs = response.data.data.viewer.pullRequests.nodes;
      const recentPRs = allPRs.filter(
        (pr: any) => !pr.title.startsWith(prTitlePrefix)
      );

      // For each PR, try to get the diff as well
      const prsWithDiff = await Promise.all(
        recentPRs.map(async (pr: any) => {
          try {
            const diffResult = await execCommand(
              'git',
              ['show', `--format=`, `origin/pr-${pr.number}`],
              { cwd: repositoryPath }
            );

            return {
              title: pr.title,
              body: pr.body || '',
              diff: diffResult.exitCode === 0 ? diffResult.stdout : undefined,
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
