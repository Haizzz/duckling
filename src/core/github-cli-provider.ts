/**
 * GitHub CLI Provider - Implements GitHub operations using GitHub CLI
 */

import { GitHubProvider } from './github-interface';
import { DatabaseManager } from './database';
import { OpenAIManager } from './openai-manager';
import { executeGitHubCLI } from '../utils/github-cli-utils';
import { validateAndGetRepoInfo } from '../utils/git-utils';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';
import { execCommand } from '../utils/exec';

export class GitHubCLIProvider implements GitHubProvider {
  private db: DatabaseManager;
  private openaiManager: OpenAIManager;
  private repoOwner: string = '';
  private repoName: string = '';
  private initialized: boolean = false;

  constructor(db: DatabaseManager, openaiManager: OpenAIManager) {
    this.db = db;
    this.openaiManager = openaiManager;
  }

  private async ensureInitialized(repositoryPath: string) {
    if (this.initialized) return;

    try {
      const repoInfo = await validateAndGetRepoInfo(repositoryPath);
      this.repoOwner = repoInfo.owner;
      this.repoName = repoInfo.name;
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to get repository information: ${error}`);
    }
  }

  private async getCurrentGitHubUsername(
    repositoryPath: string
  ): Promise<string> {
    try {
      const result = await execCommand('gh', ['api', 'user'], {
        cwd: repositoryPath,
      });
      if (result.exitCode !== 0) {
        throw new Error(`GitHub CLI command failed: ${result.stderr}`);
      }
      const userData = JSON.parse(result.stdout);
      return userData.login;
    } catch (error) {
      logger.warn('Could not get GitHub username from CLI:', String(error));
      throw new Error('Failed to determine GitHub username');
    }
  }

  async getDefaultBranch(repositoryPath: string): Promise<string> {
    await this.ensureInitialized(repositoryPath);

    return await withRetry(async () => {
      try {
        const result = await execCommand(
          'gh',
          [
            'repo',
            'view',
            `${this.repoOwner}/${this.repoName}`,
            '--json',
            'defaultBranchRef',
          ],
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
    taskDescription: string,
    taskId: number,
    repositoryPath: string
  ): Promise<{ number: number; url: string }> {
    await this.ensureInitialized(repositoryPath);

    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: '🤖 Generating PR title and description...',
    });

    // Generate intelligent title and description using OpenAI
    const title = await this.openaiManager.generatePRTitle(taskDescription);
    const description = await this.openaiManager.generatePRDescription(
      taskDescription,
      branchName
    );

    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: `📋 Generated PR title: "${title}"`,
    });

    return this.createPR(
      branchName,
      title,
      description,
      taskId,
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
      // Get current GitHub username
      const actualTargetUsername =
        await this.getCurrentGitHubUsername(repositoryPath);

      // Get PR reviews using GitHub CLI
      const reviewsResult = await execCommand(
        'gh',
        ['pr', 'view', prNumber.toString(), '--json', 'reviews'],
        { cwd: repositoryPath }
      );
      if (reviewsResult.exitCode !== 0) {
        throw new Error(`GitHub CLI command failed: ${reviewsResult.stderr}`);
      }

      const data = JSON.parse(reviewsResult.stdout);
      const reviews = data.reviews || [];

      // Filter reviews from the target user and newer than last commit timestamp
      const newReviews = reviews.filter((review: any) => {
        logger.info(
          `review author ${review.author.login}, target ${actualTargetUsername}, ` +
            `review time ${new Date(review.submittedAt)}, commit time ${lastCommitTimestamp ? new Date(lastCommitTimestamp) : 'null'}, ` +
            `review state ${review.state}`
        );

        const isFromTargetUser =
          review.author.login.toLowerCase() ===
          actualTargetUsername.toLowerCase();
        const isNewerThanCommit = lastCommitTimestamp
          ? new Date(review.submittedAt) > new Date(lastCommitTimestamp)
          : true;
        const isSubmittedReview = review.state && review.state !== 'PENDING';

        return isFromTargetUser && isNewerThanCommit && isSubmittedReview;
      });

      // Format reviews for processing
      const formattedReviews = [];
      for (const review of newReviews) {
        let reviewString = `Review by ${review.author.login} (${review.state}):\n`;

        // Add review body if it exists
        if (review.body && review.body.trim()) {
          reviewString += `Overall Comment: ${review.body}\n\n`;
        }

        // Get review comments if available
        if (review.comments && review.comments.length > 0) {
          reviewString += `Line Comments:\n`;
          for (const comment of review.comments) {
            if (comment.path) reviewString += `File: ${comment.path}\n`;
            if (comment.line !== undefined)
              reviewString += `Line: ${comment.line}\n`;
            if (comment.diffHunk)
              reviewString += `Context: ${comment.diffHunk}\n`;
            reviewString += `Comment: ${comment.body}\n\n`;
          }
        }

        const hasBody = review.body && review.body.trim();
        const hasComments = review.comments && review.comments.length > 0;

        if (hasBody || hasComments) {
          formattedReviews.push(reviewString.trim());
        }
      }

      return formattedReviews;
    } catch (error) {
      logger.error('Failed to fetch PR reviews via GitHub CLI:', String(error));
      return [];
    }
  }

  async getPRReviews(prNumber: number, repositoryPath: string): Promise<any[]> {
    return await withRetry(
      async () => {
        await this.ensureInitialized(repositoryPath);

        const result = await execCommand(
          'gh',
          ['pr', 'view', prNumber.toString(), '--json', 'reviews'],
          { cwd: repositoryPath }
        );
        if (result.exitCode !== 0) {
          throw new Error(`GitHub CLI command failed: ${result.stderr}`);
        }

        const data = JSON.parse(result.stdout);
        return data.reviews || [];
      },
      'Get PR reviews via GitHub CLI',
      2
    );
  }

  async getCommentsForReview(
    prNumber: number,
    reviewId: number,
    repositoryPath: string
  ): Promise<any[]> {
    return await withRetry(
      async () => {
        await this.ensureInitialized(repositoryPath);

        // GitHub CLI doesn't have direct review comment access,
        // so we'll get all comments and filter by review ID
        const result = await execCommand(
          'gh',
          ['pr', 'view', prNumber.toString(), '--json', 'comments'],
          { cwd: repositoryPath }
        );
        if (result.exitCode !== 0) {
          throw new Error(`GitHub CLI command failed: ${result.stderr}`);
        }

        const data = JSON.parse(result.stdout);
        const comments = data.comments || [];

        // Filter comments that belong to the specific review
        return comments.filter((comment: any) => comment.reviewId === reviewId);
      },
      'Get comments for review via GitHub CLI',
      2
    );
  }

  async getPRReviewComments(
    prNumber: number,
    repositoryPath: string
  ): Promise<any[]> {
    return await withRetry(
      async () => {
        await this.ensureInitialized(repositoryPath);

        const result = await execCommand(
          'gh',
          ['pr', 'view', prNumber.toString(), '--json', 'comments'],
          { cwd: repositoryPath }
        );
        if (result.exitCode !== 0) {
          throw new Error(`GitHub CLI command failed: ${result.stderr}`);
        }

        const data = JSON.parse(result.stdout);
        return data.comments || [];
      },
      'Get PR review comments via GitHub CLI',
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
            'state,mergeable,merged',
          ],
          { cwd: repositoryPath }
        );
        if (result.exitCode !== 0) {
          throw new Error(`GitHub CLI command failed: ${result.stderr}`);
        }

        const data = JSON.parse(result.stdout);
        return {
          state: data.state || 'UNKNOWN',
          mergeable: data.mergeable !== undefined ? data.mergeable : null,
          merged: data.merged || false,
        };
      },
      'Get PR status via GitHub CLI',
      2
    );
  }

  private logPREvent(taskId: number, message: string): void {
    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message,
    });
  }
}
