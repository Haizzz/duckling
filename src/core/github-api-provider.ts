/**
 * GitHub API Provider - Implements GitHub operations using direct GitHub API calls
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

export class GitHubAPIProvider {
  private db: DatabaseManager;
  private openaiManager: OpenAIManager;
  private settings: SettingsManager;
  private jiraManager: JiraManager;
  private repoOwner: string = '';
  private repoName: string = '';
  private currentRepoPath: string = '';
  private token: string = '';

  constructor(
    db: DatabaseManager,
    openaiManager: OpenAIManager,
    settings: SettingsManager,
    jiraManager: JiraManager
  ) {
    this.db = db;
    this.openaiManager = openaiManager;
    this.settings = settings;
    this.jiraManager = jiraManager;
  }

  private async ensureInitialized(repositoryPath: string) {
    // Re-initialize if repository path has changed
    if (this.currentRepoPath === repositoryPath && this.token) return;

    try {
      const repoInfo = await validateAndGetRepoInfo(repositoryPath);
      this.repoOwner = repoInfo.owner;
      this.repoName = repoInfo.name;
      this.currentRepoPath = repositoryPath;

      // Get GitHub token from gh CLI
      await this.getGitHubToken(repositoryPath);
    } catch (error) {
      throw new Error(`Failed to get repository information: ${error}`);
    }
  }

  private async getGitHubToken(repositoryPath: string): Promise<void> {
    try {
      const result = await execCommand('gh', ['auth', 'token'], {
        cwd: repositoryPath,
      });
      if (result.exitCode !== 0) {
        throw new Error(`GitHub CLI command failed: ${result.stderr}`);
      }
      this.token = result.stdout.trim();
    } catch (error) {
      throw new Error(`Failed to get GitHub token from CLI: ${error}`);
    }
  }

  private async makeGitHubAPIRequest(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<any> {
    const url = `https://api.github.com${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Duckling',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return response.json();
  }

  async getDefaultBranch(repositoryPath: string): Promise<string> {
    await this.ensureInitialized(repositoryPath);

    return await withRetry(async () => {
      try {
        const data = await this.makeGitHubAPIRequest(
          `/repos/${this.repoOwner}/${this.repoName}`
        );
        return data.default_branch;
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
            message: `✅ Found existing PR #${existingPR.number}: ${existingPR.html_url}`,
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
        const prData = await this.makeGitHubAPIRequest(
          `/repos/${this.repoOwner}/${this.repoName}/pulls`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              title,
              body: description,
              head: branchName,
              base: defaultBranch,
            }),
          }
        );

        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: `✅ PR created successfully: #${prData.number} - ${prData.html_url}`,
        });

        this.logPREvent(taskId, `PR created: #${prData.number}`);

        return {
          number: prData.number,
          url: prData.html_url,
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
      const pulls = await this.makeGitHubAPIRequest(
        `/repos/${this.repoOwner}/${this.repoName}/pulls?head=${this.repoOwner}:${branchName}&state=open`
      );

      return pulls.length > 0 ? pulls[0] : null;
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

        return await this.makeGitHubAPIRequest(
          `/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}/reviews`
        );
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
        const reviewLineComments = await this.makeGitHubAPIRequest(
          `/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}/reviews/${review.id}/comments`
        );

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
    const prCommentsData = await this.makeGitHubAPIRequest(
      `/repos/${this.repoOwner}/${this.repoName}/issues/${prNumber}/comments`
    );

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
          const userData = await this.makeGitHubAPIRequest('/user');
          return userData.login;
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
        const data = await this.makeGitHubAPIRequest(
          `/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}`
        );

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
        logger.warn('Could not get current user for recent PRs');
        return [];
      }

      // Get recent PRs by current user
      const pulls = await this.makeGitHubAPIRequest(
        `/repos/${this.repoOwner}/${this.repoName}/pulls?state=all&sort=created&direction=desc&per_page=10`
      );

      // Filter PRs by current user and exclude tool-generated ones
      const userPRs = pulls
        .filter(
          (pr: any) =>
            pr.user.login === currentUser && !pr.title.startsWith(prTitlePrefix)
        )
        .slice(0, 5);

      // For each PR, try to get the diff as well
      const prsWithDiff = await Promise.all(
        userPRs.map(async (pr: any) => {
          try {
            const diffResult = await execCommand(
              'git',
              ['show', `origin/${pr.head.ref}`, '--format=', '--name-only'],
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
