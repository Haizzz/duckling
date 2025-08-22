/**
 * GitHub CLI Provider - Implements GitHub operations using GitHub CLI
 */

import { executeGitHubCLI } from '../utils/github-cli-utils';
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

export class GitHubCLIProvider {
  private db: DatabaseManager;
  private openaiManager: OpenAIManager;
  private settings: SettingsManager;
  private jiraManager: JiraManager;
  private repoOwner: string = '';
  private repoName: string = '';
  private currentRepoPath: string = '';

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

  async getDefaultBranch(repositoryPath: string): Promise<string> {
    await this.ensureInitialized(repositoryPath);

    return await withRetry(async () => {
      try {
        const result = await execCommand(
          'gh',
          ['repo', 'view', '--json', 'defaultBranchRef'],
          { cwd: repositoryPath }
        );
        if (result.exitCode !== 0) {
          throw new Error(`GitHub CLI command failed: ${result.stderr}`);
        }
        const data = JSON.parse(result.stdout);
        return data.defaultBranchRef.name;
      } catch (error) {
        logger.warn(
          'Could not get default branch from GitHub CLI, falling back to "main"',
          String(error)
        );
        return 'main';
      }
    }, 'Get default branch from GitHub CLI');
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

        // Create new PR using GitHub CLI
        const result = await execCommand(
          'gh',
          [
            'pr',
            'create',
            '--title',
            title,
            '--body',
            description,
            '--head',
            branchName,
            '--base',
            defaultBranch,
          ],
          { cwd: repositoryPath }
        );
        if (result.exitCode !== 0) {
          throw new Error(`GitHub CLI command failed: ${result.stderr}`);
        }

        // Parse the PR URL from the output
        const prUrl = result.stdout.trim();
        const prNumber = parseInt(prUrl.split('/').pop() || '0');

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
      'Create PR via GitHub CLI',
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
      const result = repositoryPath
        ? await execCommand(
            'gh',
            [
              'pr',
              'list',
              '--head',
              branchName,
              '--json',
              'number,url,title',
              '--state',
              'open',
            ],
            { cwd: repositoryPath }
          )
        : await executeGitHubCLI(
            `pr list --head ${branchName} --repo ${this.repoOwner}/${this.repoName} --json number,url,title --state open`
          );

      if (repositoryPath && 'exitCode' in result && result.exitCode !== 0) {
        throw new Error(`GitHub CLI command failed: ${result.stderr}`);
      }

      const prs = JSON.parse(result.stdout);
      return prs.length > 0 ? prs[0] : null;
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
        'Failed to fetch PR comments via GitHub CLI:',
        String(error)
      );
      return [];
    }
  }

  async getPRReviews(prNumber: number, repositoryPath: string): Promise<any[]> {
    return await withRetry(
      async () => {
        await this.ensureInitialized(repositoryPath);

        const result = await execCommand(
          'gh',
          [
            'api',
            `/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}/reviews`,
          ],
          { cwd: repositoryPath }
        );
        if (result.exitCode !== 0) {
          throw new Error(`GitHub CLI command failed: ${result.stderr}`);
        }

        return JSON.parse(result.stdout);
      },
      'Get PR reviews via GitHub CLI',
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
        const reviewCommentsResult = await execCommand(
          'gh',
          [
            'api',
            `/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}/reviews/${review.id}/comments`,
          ],
          { cwd: repositoryPath }
        );
        if (reviewCommentsResult.exitCode === 0) {
          const reviewLineComments = JSON.parse(reviewCommentsResult.stdout);
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
    const prCommentsResult = await execCommand(
      'gh',
      [
        'api',
        `/repos/${this.repoOwner}/${this.repoName}/issues/${prNumber}/comments`,
      ],
      { cwd: repositoryPath }
    );
    if (prCommentsResult.exitCode === 0) {
      const prCommentsData = JSON.parse(prCommentsResult.stdout);
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
          const result = await execCommand(
            'gh',
            ['api', 'user', '--jq', '.login'],
            { cwd: repositoryPath }
          );
          if (result.exitCode !== 0) {
            throw new Error(`GitHub CLI command failed: ${result.stderr}`);
          }
          return result.stdout.trim();
        } catch (error) {
          logger.warn(
            'Could not get current user from GitHub CLI:',
            String(error)
          );
          return null;
        }
      },
      'Get current user from GitHub CLI',
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
        const result = await execCommand(
          'gh',
          [
            'pr',
            'view',
            prNumber.toString(),
            '--json',
            'state,mergeable,mergedAt',
          ],
          { cwd: repositoryPath }
        );
        if (result.exitCode !== 0) {
          throw new Error(`GitHub CLI command failed: ${result.stderr}`);
        }

        const data = JSON.parse(result.stdout);
        return {
          state: data.state || 'UNKNOWN',
          mergeable:
            data.mergeable === 'MERGEABLE'
              ? true
              : data.mergeable === 'CONFLICTING'
                ? false
                : null,
          merged: data.mergedAt !== null && data.mergedAt !== undefined,
        };
      },
      'Get PR status via GitHub CLI',
      2
    );
  }

  async getRecentUserPRs(
    repositoryPath: string
  ): Promise<Array<{ title: string; body: string; diff?: string }>> {
    await this.ensureInitialized(repositoryPath);

    try {
      const prTitlePrefix = this.settings.get('prTitlePrefix');

      // Use GraphQL to get recent PRs and filter out tool-generated ones
      const graphqlQuery = `query { viewer { pullRequests(first: 5, states: [OPEN, CLOSED, MERGED], orderBy: {field: CREATED_AT, direction: DESC}) { nodes { number title body author { login } } } } }`;

      const result = await execCommand(
        'gh',
        ['api', 'graphql', '-f', `query=${graphqlQuery}`],
        { cwd: repositoryPath }
      );

      if (result.exitCode !== 0) {
        logger.warn(`Could not fetch recent PRs: ${result.stderr}`);
        return [];
      }

      const graphqlResponse = JSON.parse(result.stdout);

      // Filter out PRs created by this tool (those with the prefix)
      const allPRs = graphqlResponse.data.viewer.pullRequests.nodes;
      const recentPRs = allPRs.filter(
        (pr: any) => !pr.title.startsWith(prTitlePrefix)
      );

      // For each PR, try to get the diff as well
      const prsWithDiff = await Promise.all(
        recentPRs.map(async (pr: any) => {
          try {
            const diffResult = await execCommand(
              'gh',
              ['pr', 'diff', pr.number.toString()],
              { cwd: repositoryPath }
            );

            // No need to strip prefix since we filtered out tool-generated PRs
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
      const result = await execCommand('git', ['diff', `${branchName}`], {
        cwd: repositoryPath,
      });

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
