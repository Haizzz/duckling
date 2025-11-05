import { simpleGit, SimpleGit } from 'simple-git';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';
import { GitHubCLIProvider } from './github-cli-provider';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseManager } from './database';
import { SettingsManager } from './settings-manager';
import { OpenAIManager } from './openai-manager';
import { JiraManager } from './jira-manager';

export class GitManager {
  private git: SimpleGit;
  private db: DatabaseManager;
  private settings: SettingsManager;
  private openaiManager: OpenAIManager;
  private jiraManager: JiraManager;
  private repoPath: string;
  private githubProvider: GitHubCLIProvider;

  constructor(
    db: DatabaseManager,
    repoPath: string,
    openaiManager: OpenAIManager,
    settings: SettingsManager,
    jiraManager: JiraManager,
    githubProvider: GitHubCLIProvider
  ) {
    this.db = db;
    this.settings = settings;
    this.openaiManager = openaiManager;
    this.jiraManager = jiraManager;
    this.repoPath = repoPath;
    this.githubProvider = githubProvider;

    // Validate git repository before initializing SimpleGit
    this.validateGitRepo();
    this.git = simpleGit(repoPath);
  }

  private validateGitRepo(): void {
    // Check if directory exists
    if (!fs.existsSync(this.repoPath)) {
      throw new Error(`Repository path does not exist: ${this.repoPath}`);
    }

    // Check if directory is a git repository
    const gitDir = path.join(this.repoPath, '.git');
    if (!fs.existsSync(gitDir)) {
      throw new Error(
        `Not a git repository: ${this.repoPath}. Please ensure the server is started from within a git repository.`
      );
    }
  }

  async getLastCommitTimestamp(branchName: string): Promise<string> {
    return await withRetry(
      async () => {
        // Get the timestamp of the last commit
        logger.info(`Getting last commit timestamp for branch: ${branchName}`);
        await this.git.fetch('origin', branchName);
        const log = await this.git.log([
          '-1',
          '--format=%cI',
          `origin/${branchName}`,
        ]);

        if (log.latest) {
          // it's parsed wrong
          return log.latest.hash;
        }

        throw new Error(`No commits found for branch ${branchName}`);
      },
      'Get last commit timestamp',
      2
    );
  }

  async createAndCheckoutBranch(
    generatedBranchName: string,
    taskId: number
  ): Promise<string> {
    return await withRetry(async () => {
      const branchPrefix = this.settings.get('branchPrefix');
      const defaultBranch = await this.githubProvider.getDefaultBranch(
        this.repoPath
      );

      logger.info(
        `Updating to latest ${defaultBranch} and creating new branch`,
        taskId.toString()
      );

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `📥 Fetching latest changes from ${defaultBranch}...`,
      });

      // First, get latest changes for the default branch
      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🔄 Switching to ${defaultBranch} and pulling latest...`,
      });

      // Discard any local changes and untracked files, then switch to base branch
      await this.git.reset(['--hard']);
      await this.git.clean('f', ['-d']);
      await this.git.checkout(defaultBranch);

      // Hard pull: fetch and reset to origin state to override any local changes
      await this.git.fetch('origin', defaultBranch);
      await this.git.reset(['--hard', `origin/${defaultBranch}`]);

      // Generate unique branch name
      let branchName = `${branchPrefix}${generatedBranchName}`;
      let counter = 1;

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🔍 Checking if branch name '${branchName}' is available...`,
      });

      while (await this.branchExists(branchName)) {
        branchName = `${branchPrefix}${generatedBranchName}-${counter}`;
        counter++;
      }

      if (counter > 1) {
        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: `ℹ️ Branch name adjusted to avoid conflicts: ${branchName}`,
        });
      }

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🌱 Creating and checking out new branch: ${branchName}`,
      });

      // Create and checkout the new branch
      await this.git.checkoutLocalBranch(branchName);

      logger.info(
        `Created and switched to branch: ${branchName}`,
        taskId.toString()
      );
      return branchName;
    }, 'Create and checkout branch');
  }

  async branchExists(branchName: string): Promise<boolean> {
    try {
      const branches = await this.git.branchLocal();
      return branches.all.includes(branchName);
    } catch (error: unknown) {
      return false;
    }
  }

  async commitChanges(taskDescription: string, taskId: number): Promise<void> {
    return await withRetry(async () => {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: '📁 Adding all changes to staging area...',
      });

      // Add all changes
      await this.git.add('.');

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: '🔍 Checking for changes to commit...',
      });

      // Check if there are changes to commit
      const status = await this.git.status();
      if (status.files.length === 0) {
        this.db.addTaskLog({
          task_id: taskId,
          level: 'error',
          message: '❌ No changes to commit found',
        });
        throw new Error('No changes to commit');
      }

      // Get list of changed files for context
      const changedFiles = [
        ...status.modified,
        ...status.created,
        ...status.deleted,
      ];

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `📝 Found ${changedFiles.length} changed files, generating commit message...`,
      });

      // Generate intelligent commit message
      const message = await this.openaiManager.generateCommitMessage(
        taskDescription,
        changedFiles,
        taskId
      );

      // Apply commit suffix from settings
      const suffix = this.settings.get('commitSuffix');
      const finalMessage = message.endsWith(suffix)
        ? message
        : `${message}${suffix}`;

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `💾 Committing with message: "${finalMessage}"`,
      });

      // Commit changes
      await this.git.commit(finalMessage);

      logger.info(`Committed changes: ${finalMessage}`, taskId.toString());
    }, 'Commit changes');
  }

  async pushBranch(branchName: string, taskId: number): Promise<void> {
    return await withRetry(async () => {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🚀 Pushing branch '${branchName}' to origin...`,
      });

      await this.git.push('origin', branchName);
      logger.info(`Pushed branch: ${branchName}`, taskId.toString());
    }, 'Push branch');
  }

  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current || 'main';
  }

  async switchToBranch(branchName: string, taskId: number): Promise<void> {
    return await withRetry(async () => {
      logger.info(
        `Fetching and switching to branch: ${branchName}`,
        taskId.toString()
      );

      // Fetch the specific branch first to ensure we have latest changes
      await this.git.fetch('origin', branchName);

      // reset before checkout
      await this.git.reset(['--hard', `${branchName}`]);
      await this.git.clean('f', ['-d']);

      // Switch to the branch
      await this.git.checkout(branchName);

      // Reset hard to origin branch to discard any local changes
      await this.git.reset(['--hard', `origin/${branchName}`]);
      await this.git.clean('f', ['-d']);
    }, 'Switch to branch');
  }

  // Note: Branch deletion is not allowed per requirements

  async fetchBranch(branchName: string, taskId?: number): Promise<void> {
    return await withRetry(async () => {
      if (taskId)
        logger.info(
          `Fetching latest changes for branch: ${branchName}`,
          taskId.toString()
        );
      await this.git.fetch('origin', branchName);
    }, `Fetch branch ${branchName}`);
  }

  async getChangedFiles(): Promise<string[]> {
    const status = await this.git.status();
    return [
      ...status.created,
      ...status.modified,
      ...status.deleted,
      ...status.renamed.map((r) => r.to || r.from),
    ];
  }

  async getDiff(branchName?: string): Promise<string> {
    if (branchName) {
      const defaultBranch = await this.githubProvider.getDefaultBranch(
        this.repoPath
      );
      return await this.git.diff([`origin/${defaultBranch}...${branchName}`]);
    }
    return await this.git.diff();
  }

  async pullLatest(
    branchName: string = 'main',
    taskId?: number
  ): Promise<void> {
    return await withRetry(async () => {
      // Hard pull: fetch and reset to origin state to override any local changes
      await this.git.fetch('origin', branchName);
      await this.git.reset(['--hard', `origin/${branchName}`]);
      if (taskId)
        logger.info(
          `Hard pulled latest changes from ${branchName}`,
          taskId.toString()
        );
    }, 'Hard pull latest changes');
  }
}
