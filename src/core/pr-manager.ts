import { Octokit } from '@octokit/rest';
import { withRetry } from '../utils/retry';
import { DatabaseManager } from './database';
import { OpenAIManager } from './openai-manager';
import { validateAndGetRepoInfo } from '../utils/git-utils';
import { logger } from '../utils/logger';

export class PRManager {
  private octokit: Octokit;
  private db: DatabaseManager;
  private openaiManager: OpenAIManager;
  private repoOwner: string = '';
  private repoName: string = '';
  private initialized: boolean = false;

  constructor(githubToken: string, db: DatabaseManager, openaiManager: OpenAIManager) {
    this.octokit = new Octokit({
      auth: githubToken,
    });
    this.db = db;
    this.openaiManager = openaiManager;
  }

  private async ensureInitialized() {
    if (this.initialized) return;

    try {
      const repoInfo = await validateAndGetRepoInfo(process.cwd());
      this.repoOwner = repoInfo.owner;
      this.repoName = repoInfo.name;
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to get repository information: ${error}`);
    }
  }

  async createPRFromTask(
    branchName: string,
    taskDescription: string,
    taskId: number
  ): Promise<{ number: number; url: string }> {
    await this.ensureInitialized();

    // Generate intelligent title and description using OpenAI
    const title = await this.openaiManager.generatePRTitle(taskDescription, branchName);
    const description = await this.openaiManager.generatePRDescription(taskDescription, branchName);

    return this.createPR(branchName, title, description, taskId);
  }

  async createPR(
    branchName: string,
    title: string,
    description: string,
    taskId: number
  ): Promise<{ number: number; url: string }> {
    await this.ensureInitialized();

    return await withRetry(async () => {
      // Check if PR already exists for this branch
      const existingPR = await this.findPRByBranch(branchName);
      if (existingPR) {
        return {
          number: existingPR.number,
          url: existingPR.html_url
        };
      }

      // Get base branch from settings
      const baseBranchSetting = this.db.getSetting('baseBranch');
      const baseBranch = baseBranchSetting?.value || 'main';

      // Create new PR
      const response = await this.octokit.rest.pulls.create({
        owner: this.repoOwner,
        repo: this.repoName,
        title,
        body: description,
        head: branchName,
        base: baseBranch
      });

      this.logPREvent(taskId, `PR created: #${response.data.number}`);

      return {
        number: response.data.number,
        url: response.data.html_url
      };
    }, 'Create PR', 3);
  }

  async updatePR(
    prNumber: number,
    title?: string,
    description?: string,
    taskId?: number
  ): Promise<void> {
    return await withRetry(async () => {
      const updateData: any = {};

      if (title) updateData.title = title;
      if (description) updateData.body = description;

      if (Object.keys(updateData).length === 0) return;

      await this.octokit.rest.pulls.update({
        owner: this.repoOwner,
        repo: this.repoName,
        pull_number: prNumber,
        ...updateData
      });

      if (taskId) {
        this.logPREvent(taskId, `PR updated: #${prNumber}`);
      }
    }, 'Update PR', 3);
  }

  async findPRByBranch(branchName: string): Promise<any> {
    try {
      const response = await this.octokit.rest.pulls.list({
        owner: this.repoOwner,
        repo: this.repoName,
        head: `${this.repoOwner}:${branchName}`,
        state: 'open'
      });

      return response.data.length > 0 ? response.data[0] : null;
    } catch (error) {
      return null;
    }
  }

  async pollForComments(
    prNumber: number,
    lastCommitTimestamp: string | null,
    targetUsername: string
  ): Promise<any[]> {
    try {
      // Only get PR review comments (not regular PR comments)
      const reviewComments = await this.getPRReviewComments(prNumber);

      // Filter comments from the target user and newer than last commit timestamp
      const newComments = reviewComments.filter(comment => {
        const isFromTargetUser = comment.user.login.toLowerCase() === targetUsername.toLowerCase();
        logger.info(`comment time ${new Date(comment.created_at)}, commit time ${lastCommitTimestamp ? new Date(lastCommitTimestamp) : 'null'}`);
        const isNewer = !lastCommitTimestamp || new Date(comment.created_at) > new Date(lastCommitTimestamp);
        return isFromTargetUser && isNewer;
      });

      return newComments;
    } catch (error) {
      console.error('Error polling for PR review comments:', error);
      return [];
    }
  }

  async getPRReviewComments(prNumber: number): Promise<any[]> {
    return await withRetry(async () => {
      await this.ensureInitialized();

      const params = {
        owner: this.repoOwner,
        repo: this.repoName,
        pull_number: prNumber
      };

      const response = await this.octokit.rest.pulls.listReviewComments(params);
      return response.data;
    }, 'Get PR review comments', 2);
  }

  async addComment(prNumber: number, comment: string, taskId?: number): Promise<void> {
    return await withRetry(async () => {
      await this.octokit.rest.issues.createComment({
        owner: this.repoOwner,
        repo: this.repoName,
        issue_number: prNumber,
        body: comment
      });

      if (taskId) {
        this.logPREvent(taskId, `Comment added to PR #${prNumber}`);
      }
    }, 'Add PR comment', 2);
  }

  async getPRStatus(prNumber: number): Promise<{
    state: string;
    mergeable: boolean | null;
    merged: boolean;
  }> {
    await this.ensureInitialized();

    return await withRetry(async () => {
      const response = await this.octokit.rest.pulls.get({
        owner: this.repoOwner,
        repo: this.repoName,
        pull_number: prNumber
      });

      return {
        state: response.data.state,
        mergeable: response.data.mergeable,
        merged: response.data.merged
      };
    }, 'Get PR status', 2);
  }

  // Note: PR merge and close functionality removed per requirements
  // The system can only create PRs and push new commits

  private logPREvent(taskId: number, message: string): void {
    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message
    });
  }
}
