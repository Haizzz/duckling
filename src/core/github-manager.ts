/**
 * GitHub Manager - Handles all GitHub API interactions
 *
 * This manager provides GitHub-specific functionality including:
 * - Getting repository default branches
 * - Creating and managing pull requests
 * - Handling PR comments and reviews
 */

import { Octokit } from '@octokit/rest';
import { withRetry } from '../utils/retry';
import { DatabaseManager } from './database';
import { SettingsManager } from './settings-manager';
import { OpenAIManager } from './openai-manager';
import { validateAndGetRepoInfo } from '../utils/git-utils';
import { logger } from '../utils/logger';

export class GitHubManager {
  private octokit: Octokit;
  private db: DatabaseManager;
  private settings: SettingsManager;
  private openaiManager: OpenAIManager;
  private repoOwner: string = '';
  private repoName: string = '';
  private initialized: boolean = false;

  constructor(
    githubToken: string,
    db: DatabaseManager,
    openaiManager: OpenAIManager
  ) {
    this.octokit = new Octokit({
      auth: githubToken,
    });
    this.db = db;
    this.settings = new SettingsManager(db);
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

  /**
   * Get the default branch for a repository using GitHub API
   */
  async getDefaultBranch(repositoryPath: string): Promise<string> {
    await this.ensureInitialized(repositoryPath);

    return await withRetry(async () => {
      try {
        const response = await this.octokit.rest.repos.get({
          owner: this.repoOwner,
          repo: this.repoName,
        });

        return response.data.default_branch;
      } catch (error) {
        logger.warn(
          'Could not get default branch from GitHub API, falling back to "main"',
          String(error)
        );
        return 'main';
      }
    }, 'Get default branch from GitHub');
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
        const existingPR = await this.findPRByBranch(branchName);
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

        // Get the default branch from the repository (avoid recursion by calling internal method)
        const repoResponse = await this.octokit.rest.repos.get({
          owner: this.repoOwner,
          repo: this.repoName,
        });
        const defaultBranch = repoResponse.data.default_branch;

        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: `🚀 Creating new PR from ${branchName} to ${defaultBranch}...`,
        });

        // Create new PR
        const createResponse = await this.octokit.rest.pulls.create({
          owner: this.repoOwner,
          repo: this.repoName,
          title,
          body: description,
          head: branchName,
          base: defaultBranch,
        });

        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: `✅ PR created successfully: #${createResponse.data.number} - ${createResponse.data.html_url}`,
        });

        this.logPREvent(taskId, `PR created: #${createResponse.data.number}`);

        return {
          number: createResponse.data.number,
          url: createResponse.data.html_url,
        };
      },
      'Create PR',
      3
    );
  }

  async findPRByBranch(branchName: string): Promise<any> {
    try {
      const response = await this.octokit.rest.pulls.list({
        owner: this.repoOwner,
        repo: this.repoName,
        head: `${this.repoOwner}:${branchName}`,
        state: 'open',
      });

      return response.data.length > 0 ? response.data[0] : null;
    } catch (error) {
      return null;
    }
  }

  async pollForComments(
    prNumber: number,
    lastCommitTimestamp: string | null,
    targetUsername: string,
    repositoryPath: string
  ): Promise<string[]> {
    try {
      // Get PR reviews (not individual review comments)
      const reviews = await this.getPRReviews(
        prNumber,
        repositoryPath
      );

      // Filter reviews from the target user and newer than last commit timestamp
      // Only consider actual reviews with state (APPROVED, CHANGES_REQUESTED, COMMENTED)
      const newReviews = reviews.filter((review) => {
        logger.info(
          `review author ${review.user.login}, target ${targetUsername}, ` +
          `review time ${new Date(review.submitted_at)}, commit time ${lastCommitTimestamp ? new Date(lastCommitTimestamp) : 'null'}, ` +
          `review state ${review.state}`
        );

        const isFromTargetUser =
          review.user.login.toLowerCase() === targetUsername.toLowerCase();
        const isNewerThanCommit = lastCommitTimestamp
          ? new Date(review.submitted_at) > new Date(lastCommitTimestamp)
          : true;
        // Only consider submitted reviews (not PENDING state)
        const isSubmittedReview = review.state && review.state !== 'PENDING';

        return isFromTargetUser && isNewerThanCommit && isSubmittedReview;
      });

      // For each review, combine review body and line comments into a formatted string
      const formattedReviews = [];
      // Get all review IDs from new reviews to check if replies are within this set
      const newReviewIds = new Set(newReviews.map(r => r.id));
      
      for (const review of newReviews) {
        let reviewString = `Review by ${review.user.login} (${review.state}):\n`;
        let reviewComments = [];

        // Add review body if it exists
        if (review.body && review.body.trim()) {
          reviewString += `Overall Comment: ${review.body}\n\n`;
        }

        // Get individual line comments for this review
        try {
          reviewComments = await this.getCommentsForReview(
            prNumber,
            review.id,
            repositoryPath
          );

          // Filter out comments that are replies to comments NOT in our current review set
          const originalComments = reviewComments.filter(comment => {
            if (!comment.in_reply_to_id) return true; // Not a reply, include it
            // Check if the reply is to a comment in one of our new reviews
            return newReviewIds.has(comment.in_reply_to_id);
          });

          if (originalComments.length > 0) {
            reviewString += `Line Comments:\n`;
            for (const comment of originalComments) {
              if (comment.path) reviewString += `File: ${comment.path}\n`;
              if (comment.line !== undefined) reviewString += `Line: ${comment.line}\n`;
              if (comment.diff_hunk) reviewString += `Context: ${comment.diff_hunk}\n`;
              reviewString += `Comment: ${comment.body}\n\n`;
            }
          }
        } catch (error) {
          logger.error(`Failed to get comments for review ${review.id}:`, String(error));
        }

        // Include all reviews from the target user (body or line comments)
        const hasBody = review.body && review.body.trim();
        const hasComments = reviewComments.length > 0;

        if (hasBody || hasComments) {
          formattedReviews.push(reviewString.trim());
        }
      }

      return formattedReviews;
    } catch (error) {
      logger.error('Failed to fetch PR reviews:', String(error));
      return [];
    }
  }

  async getPRReviews(
    prNumber: number,
    repositoryPath: string
  ): Promise<any[]> {
    return await withRetry(
      async () => {
        await this.ensureInitialized(repositoryPath);

        const params = {
          owner: this.repoOwner,
          repo: this.repoName,
          pull_number: prNumber,
        };

        const response = await this.octokit.rest.pulls.listReviews(params);
        return response.data;
      },
      'Get PR reviews',
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

        const params = {
          owner: this.repoOwner,
          repo: this.repoName,
          pull_number: prNumber,
          review_id: reviewId,
        };

        const response = await this.octokit.rest.pulls.listCommentsForReview(params);
        return response.data;
      },
      'Get comments for review',
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

        const params = {
          owner: this.repoOwner,
          repo: this.repoName,
          pull_number: prNumber,
        };

        const response =
          await this.octokit.rest.pulls.listReviewComments(params);
        return response.data;
      },
      'Get PR review comments',
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
        const response = await this.octokit.rest.pulls.get({
          owner: this.repoOwner,
          repo: this.repoName,
          pull_number: prNumber,
        });

        return {
          state: response.data.state,
          mergeable: response.data.mergeable,
          merged: response.data.merged,
        };
      },
      'Get PR status',
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
