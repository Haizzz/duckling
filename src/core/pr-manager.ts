import { Octokit } from '@octokit/rest';
import { withRetry } from '../utils/retry';
import { DatabaseManager } from './database';
import { OpenAIManager } from './openai-manager';
import { validateAndGetRepoInfo } from '../utils/git-utils';

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
    taskId: string
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
    taskId: string
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

      // Create new PR
      const response = await this.octokit.rest.pulls.create({
        owner: this.repoOwner,
        repo: this.repoName,
        title,
        body: description,
        head: branchName,
        base: 'main'
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
    taskId?: string
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

  async getPRComments(prNumber: number, since?: string): Promise<any[]> {
    return await withRetry(async () => {
      const params: any = {
        owner: this.repoOwner,
        repo: this.repoName,
        issue_number: prNumber // Comments API uses issue_number for PRs
      };

      if (since) {
        params.since = since;
      }

      const response = await this.octokit.rest.issues.listComments(params);
      return response.data;
    }, 'Get PR comments', 2);
  }

  async pollForComments(
    prNumber: number,
    lastCommentId: number | null,
    targetUsername: string
  ): Promise<any[]> {
    try {
      const comments = await this.getPRComments(prNumber);
      
      // Filter comments from the target user and newer than lastCommentId
      const newComments = comments.filter(comment => {
        const isFromTargetUser = comment.user.login === targetUsername;
        const isNewer = !lastCommentId || comment.id > lastCommentId;
        return isFromTargetUser && isNewer;
      });

      return newComments;
    } catch (error) {
      console.error('Error polling for PR comments:', error);
      return [];
    }
  }

  async addComment(prNumber: number, comment: string, taskId?: string): Promise<void> {
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

  private logPREvent(taskId: string, message: string): void {
    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message
    });
  }
}
