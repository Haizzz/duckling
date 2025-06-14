import { simpleGit, SimpleGit } from 'simple-git';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';
import { DatabaseManager } from './database';
import { OpenAIManager } from './openai-manager';
import { execCommand } from '../utils/exec';

export class GitManager {
  private git: SimpleGit;
  private db: DatabaseManager;
  private openaiManager: OpenAIManager;
  private repoPath: string;

  constructor(db: DatabaseManager, repoPath: string = process.cwd(), openaiManager?: OpenAIManager) {
    this.git = simpleGit(repoPath);
    this.db = db;
    this.openaiManager = openaiManager || new OpenAIManager(db);
    this.repoPath = repoPath;
  }

  async getLastCommitTimestamp(branchName: string): Promise<string> {
    return await withRetry(async () => {
      // Switch to the branch first
      await this.git.checkout(branchName);

      // Get the timestamp of the last commit
      const log = await this.git.log(['-1', '--format=%cI']);

      if (log.latest) {
        return log.latest.date;
      }

      throw new Error(`No commits found for branch ${branchName}`);
    }, 'Get last commit timestamp', 2);
  }

  async createAndCheckoutBranch(baseBranchName: string, taskId: number, branchPrefix?: string): Promise<string> {
    return await withRetry(async () => {
      // Get base branch from settings
      const baseBranchSetting = this.db.getSetting('baseBranch');
      const baseBranch = baseBranchSetting?.value || 'main';

      // Get branch prefix from settings if not provided
      if (!branchPrefix) {
        const prefixSetting = this.db.getSetting('branchPrefix');
        branchPrefix = prefixSetting?.value || 'intern/';
      }

      logger.info(`Updating to latest ${baseBranch} and creating new branch`, taskId);

      // First, fetch latest changes for the specific base branch
      await this.git.fetch('origin', baseBranch);

      // Switch to base branch and pull latest  
      await this.git.checkout(baseBranch);
      await this.git.pull('origin', baseBranch);

      // Generate unique branch name
      let branchName = `${branchPrefix}${baseBranchName}`;
      let counter = 1;

      while (await this.branchExists(branchName)) {
        branchName = `${branchPrefix}${baseBranchName}-${counter}`;
        counter++;
      }

      // Create and checkout the new branch
      await this.git.checkoutLocalBranch(branchName);

      logger.info(`Created and switched to branch: ${branchName}`, taskId);
      return branchName;
    }, 'Create and checkout branch');
  }

  async branchExists(branchName: string): Promise<boolean> {
    try {
      const branches = await this.git.branchLocal();
      return branches.all.includes(branchName);
    } catch (error) {
      return false;
    }
  }

  async commitChangesWithTask(taskDescription: string, taskId: number): Promise<void> {
    // Get list of changed files for context
    const status = await this.git.status();
    const changedFiles = [...status.modified, ...status.created, ...status.deleted];

    // Generate intelligent commit message
    const message = await this.openaiManager.generateCommitMessage(taskDescription, changedFiles);

    return this.commitChanges(message, taskId);
  }

  async commitChanges(message: string, taskId: number): Promise<void> {
    return await withRetry(async () => {
      // Add all changes
      await this.git.add('.');

      // Check if there are changes to commit
      const status = await this.git.status();
      if (status.files.length === 0) {
        throw new Error('No changes to commit');
      }

      // Commit changes
      await this.git.commit(message);

      logger.info(`Committed changes: ${message}`, taskId.toString());
    }, 'Commit changes');
  }

  async pushBranch(branchName: string, taskId: number): Promise<void> {
    return await withRetry(async () => {
      await this.git.push('origin', branchName);
      logger.info(`Pushed branch: ${branchName}`, taskId.toString());
    }, 'Push branch');
  }

  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current || 'main';
  }

  async switchToBranch(branchName: string, taskId?: number): Promise<void> {
    return await withRetry(async () => {
      if (taskId) logger.info(`Fetching and switching to branch: ${branchName}`, taskId.toString());

      // Fetch the specific branch to ensure we have latest changes
      await this.git.fetch('origin', branchName);

      // Switch to the branch
      await this.git.checkout(branchName);

      // Pull any remote changes to ensure we're up to date
      try {
        await this.git.pull('origin', branchName);
        if (taskId) logger.info(`Pulled latest changes for branch: ${branchName}`, taskId.toString());
      } catch (error: any) {
        // If pull fails (e.g., no upstream), that's okay for local branches
        if (taskId) logger.info(`No upstream changes to pull for branch: ${branchName}`, taskId.toString());
      }
    }, 'Switch to branch');
  }

  // Note: Branch deletion is not allowed per requirements

  async fetchBranch(branchName: string, taskId?: number): Promise<void> {
    return await withRetry(async () => {
      if (taskId) logger.info(`Fetching latest changes for branch: ${branchName}`, taskId.toString());
      await this.git.fetch('origin', branchName);
    }, `Fetch branch ${branchName}`);
  }

  async getChangedFiles(): Promise<string[]> {
    const status = await this.git.status();
    return [
      ...status.created,
      ...status.modified,
      ...status.deleted,
      ...status.renamed.map(r => r.to || r.from)
    ];
  }

  async getDiff(branchName?: string): Promise<string> {
    if (branchName) {
      return await this.git.diff([`origin/main...${branchName}`]);
    } else {
      return await this.git.diff();
    }
  }

  async pullLatest(branchName: string = 'main', taskId?: number): Promise<void> {
    return await withRetry(async () => {
      await this.git.pull('origin', branchName);
      if (taskId) logger.info(`Pulled latest changes from ${branchName}`, taskId.toString());
    }, 'Pull latest changes');
  }
}
