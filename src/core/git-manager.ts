import { simpleGit, SimpleGit } from 'simple-git';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';
import { DatabaseManager } from './database';
import { SettingsManager } from './settings-manager';
import { OpenAIManager } from './openai-manager';
import { GitHubCLIProvider } from './github-cli-provider';
import * as path from 'path';
import * as fs from 'fs';
import { execCommand } from '../utils/exec';

export class GitManager {
  private git: SimpleGit;
  private db: DatabaseManager;
  private settings: SettingsManager;
  private openaiManager: OpenAIManager;
  private repoPath: string;

  constructor(
    db: DatabaseManager,
    repoPath: string,
    openaiManager?: OpenAIManager
  ) {
    this.db = db;
    this.settings = new SettingsManager(db);
    this.openaiManager = openaiManager || new OpenAIManager(db);
    this.repoPath = repoPath;

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
        const log = await this.git.log(['-1', '--format=%cI']);

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
  ): Promise<{ branchName: string; worktreePath: string }> {
    return await withRetry(async () => {
      const branchPrefix = this.settings.get('branchPrefix');
      const githubManager = new GitHubCLIProvider(
        this.db,
        this.openaiManager,
        this.settings
      );
      const defaultBranch = await githubManager.getDefaultBranch(this.repoPath);

      logger.info(
        `Updating to latest ${defaultBranch} and creating new worktree`,
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
      await this.git.pull('origin', defaultBranch);

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

      // Create worktree path
      const worktreePath = path.join(
        this.repoPath,
        '..',
        `${branchName}-worktree`
      );

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🌱 Creating worktree for branch: ${branchName}`,
      });

      // Create worktree
      await this.createWorktree(branchName, worktreePath, taskId);

      logger.info(
        `Created worktree for branch: ${branchName} at ${worktreePath}`,
        taskId.toString()
      );
      return { branchName, worktreePath };
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

  async createWorktree(
    branchName: string,
    worktreePath: string,
    taskId: number
  ): Promise<void> {
    try {
      // Remove existing worktree path if it exists
      if (fs.existsSync(worktreePath)) {
        await fs.promises.rm(worktreePath, { recursive: true, force: true });
      }

      // Create the worktree
      await execCommand(
        'git',
        ['worktree', 'add', worktreePath, '-b', branchName],
        {
          cwd: this.repoPath,
          taskId: taskId.toString(),
        }
      );

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `✅ Worktree created at: ${worktreePath}`,
      });
    } catch (error: any) {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'error',
        message: `❌ Failed to create worktree: ${error.message}`,
      });
      throw error;
    }
  }

  async removeWorktree(worktreePath: string, taskId: number): Promise<void> {
    try {
      if (!fs.existsSync(worktreePath)) {
        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: `⚠️ Worktree path does not exist: ${worktreePath}`,
        });
        return;
      }

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🗑️ Removing worktree: ${worktreePath}`,
      });

      // Remove the worktree
      await execCommand(
        'git',
        ['worktree', 'remove', worktreePath, '--force'],
        {
          cwd: this.repoPath,
          taskId: taskId.toString(),
        }
      );

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `✅ Worktree removed: ${worktreePath}`,
      });
    } catch (error: any) {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'error',
        message: `❌ Failed to remove worktree: ${error.message}`,
      });
      // Try to remove the directory manually as a fallback
      try {
        await fs.promises.rm(worktreePath, { recursive: true, force: true });
        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: `✅ Worktree directory removed manually: ${worktreePath}`,
        });
      } catch (fallbackError) {
        logger.error(
          `Failed to remove worktree directory: ${fallbackError}`,
          taskId.toString()
        );
      }
    }
  }

  async commitChanges(
    taskDescription: string,
    taskId: number,
    worktreePath?: string
  ): Promise<void> {
    return await withRetry(async () => {
      // Use worktree path if provided, otherwise use main repo path
      const workingDir = worktreePath || this.repoPath;
      const workingGit = simpleGit(workingDir);

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `📁 Adding all changes to staging area in ${workingDir}...`,
      });

      // Add all changes
      await workingGit.add('.');

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: '🔍 Checking for changes to commit...',
      });

      // Check if there are changes to commit
      const status = await workingGit.status();
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
      await workingGit.commit(finalMessage);

      logger.info(`Committed changes: ${finalMessage}`, taskId.toString());
    }, 'Commit changes');
  }

  async pushBranch(
    branchName: string,
    taskId: number,
    worktreePath?: string
  ): Promise<void> {
    return await withRetry(async () => {
      // Use worktree path if provided, otherwise use main repo path
      const workingDir = worktreePath || this.repoPath;
      const workingGit = simpleGit(workingDir);

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🚀 Pushing branch '${branchName}' to origin from ${workingDir}...`,
      });

      await workingGit.push('origin', branchName);
      logger.info(`Pushed branch: ${branchName}`, taskId.toString());
    }, 'Push branch');
  }

  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current || 'main';
  }

  async switchToBranch(branchName: string, taskId?: number): Promise<void> {
    return await withRetry(async () => {
      if (taskId)
        logger.info(
          `Fetching and switching to branch: ${branchName}`,
          taskId.toString()
        );

      // Discard all local changes and untracked files to ensure clean state
      await this.git.reset(['--hard']);
      await this.git.clean('f', ['-d']);

      // Fetch the specific branch to ensure we have latest changes
      await this.git.fetch('origin', branchName);

      // Switch to the branch
      await this.git.checkout(branchName);

      // Pull any remote changes to ensure we're up to date
      try {
        await this.git.pull('origin', branchName);
        if (taskId)
          logger.info(
            `Pulled latest changes for branch: ${branchName}`,
            taskId.toString()
          );
      } catch (error: any) {
        // If pull fails (e.g., no upstream), that's okay for local branches
        if (taskId)
          logger.info(
            `No upstream changes to pull for branch: ${branchName}`,
            taskId.toString()
          );
      }
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
      return await this.git.diff([`origin/main...${branchName}`]);
    } else {
      return await this.git.diff();
    }
  }

  async pullLatest(
    branchName: string = 'main',
    taskId?: number
  ): Promise<void> {
    return await withRetry(async () => {
      await this.git.pull('origin', branchName);
      if (taskId)
        logger.info(
          `Pulled latest changes from ${branchName}`,
          taskId.toString()
        );
    }, 'Pull latest changes');
  }
}
