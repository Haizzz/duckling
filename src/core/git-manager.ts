import { simpleGit } from 'simple-git';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';
import { GitHubCLIProvider } from './github-cli-provider';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseManager } from './database';
import { SettingsManager } from './settings-manager';
import { OpenAIManager } from './openai-manager';
import { JiraManager } from './jira-manager';

interface WorktreeAllocation {
  path: string;
  taskId: number | undefined;
}

class WorktreeManager {
  private static instances: Map<string, WorktreeManager> = new Map();
  private allocations: WorktreeAllocation[] = [];
  private repoPath: string;
  private db: DatabaseManager;
  private settings: SettingsManager;

  private constructor(
    repoPath: string,
    db: DatabaseManager,
    settings: SettingsManager
  ) {
    this.repoPath = repoPath;
    this.db = db;
    this.settings = settings;

    // Pre-allocate all worktree allocation objects based on settings
    const maxWorktrees = this.settings.get('maxWorktreesPerRepo');
    for (let i = 1; i <= maxWorktrees; i++) {
      this.allocations.push({
        path: this.getWorktreePath(i),
        taskId: undefined,
      });
    }
  }

  static getInstance(
    repoPath: string,
    db: DatabaseManager,
    settings: SettingsManager
  ): WorktreeManager {
    if (!WorktreeManager.instances.has(repoPath)) {
      WorktreeManager.instances.set(
        repoPath,
        new WorktreeManager(repoPath, db, settings)
      );
    }
    return WorktreeManager.instances.get(repoPath)!;
  }

  private getWorktreePath(worktreeId: number): string {
    const repoName = path.basename(this.repoPath);
    const parentDir = path.dirname(this.repoPath);
    return path.join(parentDir, `duckling-${repoName}-${worktreeId}`);
  }

  async acquireWorktree(taskId: number): Promise<string | undefined> {
    const allocation = this.allocations.find((a) => a.taskId === undefined);

    if (!allocation) {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🌳 Maximum worktrees (${this.settings.get('maxWorktreesPerRepo')}) reached for repository. Please wait for other tasks to complete.`,
      });
      return undefined;
    }

    allocation.taskId = taskId;
    this.db.updateTask(taskId, {
      current_stage: 'acquiring_worktree',
    });

    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: `🌳 Allocated worktree ${path.basename(allocation.path)} for task ${taskId}`,
    });

    // Lazily create worktree if it doesn't exist
    const mainGit = simpleGit(this.repoPath);
    const worktreeList = await mainGit.raw(['worktree', 'list', '--porcelain']);
    const worktreeExists = worktreeList.includes(`worktree ${allocation.path}`);

    if (!worktreeExists) {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🌳 Creating worktree directory: ${path.basename(allocation.path)}`,
      });

      // Create worktree with detached HEAD using main git instance
      await mainGit.raw([
        'worktree',
        'add',
        '--detach',
        allocation.path,
        'HEAD',
      ]);
    }

    return allocation.path;
  }

  async releaseWorktree(taskId: number): Promise<void> {
    const allocation = this.allocations.find((a) => a.taskId === taskId);
    // Skip if task was not found (possible if task was skipped by maximum worktrees reached)
    if (!allocation || allocation.taskId === undefined) {
      return;
    }

    // Detach HEAD to avoid conflicts with other worktrees
    try {
      const worktreeGit = simpleGit(allocation.path);
      await worktreeGit.raw(['checkout', '--detach']);
    } catch (error) {
      // Log warning but don't fail the release
      this.db.addTaskLog({
        task_id: taskId,
        level: 'warn',
        message: `⚠️ Failed to detach HEAD in worktree ${path.basename(allocation.path)}: ${error}`,
      });
    }

    allocation.taskId = undefined;

    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: `🌳 Released worktree ${path.basename(allocation.path)}`,
    });
  }

  getWorkingDirectory(taskId: number): string {
    const allocation = this.allocations.find((a) => a.taskId === taskId);
    if (!allocation) {
      throw new Error(`No worktree allocated for task ${taskId}`);
    }

    return allocation.path;
  }
}

export class GitManager {
  private db: DatabaseManager;
  private settings: SettingsManager;
  private openaiManager: OpenAIManager;
  private jiraManager: JiraManager;
  private repoPath: string;
  private mainGit: ReturnType<typeof simpleGit>;
  private worktreeManager: WorktreeManager;

  constructor(
    db: DatabaseManager,
    repoPath: string,
    openaiManager: OpenAIManager,
    settings: SettingsManager,
    jiraManager: JiraManager
  ) {
    this.db = db;
    this.settings = settings;
    this.openaiManager = openaiManager;
    this.jiraManager = jiraManager;
    this.repoPath = repoPath;
    this.validateGitRepo();
    this.mainGit = simpleGit(repoPath);
    this.worktreeManager = WorktreeManager.getInstance(repoPath, db, settings);
  }

  private getWorktreeGit(taskId: number) {
    const wtPath = this.worktreeManager.getWorkingDirectory(taskId);
    return simpleGit(wtPath);
  }

  private validateGitRepo(): void {
    if (!fs.existsSync(this.repoPath)) {
      throw new Error(`Repository path does not exist: ${this.repoPath}`);
    }

    const gitDir = path.join(this.repoPath, '.git');
    if (!fs.existsSync(gitDir)) {
      throw new Error(
        `Not a git repository: ${this.repoPath}. Please ensure the server is started from within a git repository.`
      );
    }
  }

  async acquireWorktreeForTask(taskId: number): Promise<string | undefined> {
    return await this.worktreeManager.acquireWorktree(taskId);
  }

  async releaseWorktree(taskId: number): Promise<void> {
    await this.worktreeManager.releaseWorktree(taskId);
  }

  getWorkingDirectory(taskId: number): string {
    return this.worktreeManager.getWorkingDirectory(taskId);
  }

  async getLastCommitTimestamp(branchName: string): Promise<string> {
    return await withRetry(
      async () => {
        logger.info(`Getting last commit timestamp for branch: ${branchName}`);
        await this.mainGit.fetch('origin', branchName);
        const log = await this.mainGit.log([
          '-1',
          '--format=%cI',
          `origin/${branchName}`,
        ]);

        if (log.latest) {
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
      const githubManager = new GitHubCLIProvider(
        this.db,
        this.openaiManager,
        this.settings,
        this.jiraManager
      );
      const defaultBranch = await githubManager.getDefaultBranch(this.repoPath);

      logger.info(
        `Updating to latest ${defaultBranch} and creating new branch`,
        taskId.toString()
      );

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
        message: `🌱 Creating new branch: ${branchName}`,
      });

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `📥 Fetching latest changes from ${defaultBranch} in worktree...`,
      });

      // Use local git instance for this worktree (no race conditions)
      const worktreePath = this.worktreeManager.getWorkingDirectory(taskId);
      const worktreeGit = simpleGit(worktreePath);
      await worktreeGit.fetch('origin', defaultBranch);
      await worktreeGit.reset(['--hard', `origin/${defaultBranch}`]);

      // Create and checkout the new branch in the worktree
      await worktreeGit.checkoutLocalBranch(branchName);

      logger.info(
        `Created branch and switched to worktree: ${branchName}`,
        taskId.toString()
      );
      return branchName;
    }, 'Create and checkout branch');
  }

  async branchExists(branchName: string): Promise<boolean> {
    try {
      // Check branch existence in main repo to avoid conflicts
      const branches = await this.mainGit.branchLocal();
      return branches.all.includes(branchName);
    } catch (error) {
      return false;
    }
  }

  async commitChanges(taskDescription: string, taskId: number): Promise<void> {
    return await withRetry(async () => {
      const git = this.getWorktreeGit(taskId);

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: '📁 Adding all changes to staging area...',
      });

      // Add all changes
      await git.add('.');

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: '🔍 Checking for changes to commit...',
      });

      // Check if there are changes to commit
      const status = await git.status();
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
      await git.commit(finalMessage);

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

      await this.getWorktreeGit(taskId).push('origin', branchName);
      logger.info(`Pushed branch: ${branchName}`, taskId.toString());
    }, 'Push branch');
  }

  async switchToBranch(branchName: string, taskId: number): Promise<boolean> {
    return await withRetry(async () => {
      logger.info(
        `Switching to worktree for branch: ${branchName}`,
        taskId.toString()
      );
      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🔄 Switching to branch '${branchName}'...`,
      });

      // Check if main repo is on the same branch and detach if so
      try {
        const currentBranch = await this.mainGit.branch();
        if (currentBranch.current === branchName) {
          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: `🔄 Detaching main repo HEAD to avoid branch conflict with '${branchName}'`,
          });
          await this.mainGit.raw(['checkout', '--detach']);
        }
      } catch (error) {
        // Log warning but continue - this is not critical
        this.db.addTaskLog({
          task_id: taskId,
          level: 'warn',
          message: `⚠️ Failed to check/detach main repo branch: ${error}`,
        });
      }

      const worktreeGit = this.getWorktreeGit(taskId);
      await worktreeGit.fetch('origin', branchName);
      await worktreeGit.checkout(branchName);
      await worktreeGit.reset(['--hard', `origin/${branchName}`]);

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `✅ Successfully switched to branch '${branchName}' in worktree`,
      });

      return true;
    }, 'Switch to branch');
  }
}
