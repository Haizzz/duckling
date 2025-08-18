import { simpleGit, SimpleGit } from 'simple-git';
import { logger } from '../utils/logger';
import { DatabaseManager } from './database';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface Worktree {
  id: string;
  path: string;
  taskId?: number;
  branchName?: string;
  inUse: boolean;
  createdAt: Date;
}

export interface WorktreeAcquisition {
  worktree: Worktree;
  release: () => Promise<void>;
}

export class WorktreeManager {
  private static instance: WorktreeManager;
  private git: SimpleGit;
  private db: DatabaseManager;
  private mainRepoPath: string;
  private worktreeBaseDir: string;
  private worktrees: Map<string, Worktree> = new Map();
  private maxWorktrees: number = 3;
  private acquisitionQueue: Array<{
    resolve: (acquisition: WorktreeAcquisition) => void;
    reject: (error: Error) => void;
    taskId: number;
  }> = [];

  static getInstance(): WorktreeManager {
    if (!WorktreeManager.instance) {
      throw new Error(
        'WorktreeManager not initialized. Call initialize() first.'
      );
    }
    return WorktreeManager.instance;
  }

  static async initialize(
    db: DatabaseManager,
    mainRepoPath: string
  ): Promise<WorktreeManager> {
    if (WorktreeManager.instance) {
      return WorktreeManager.instance;
    }

    WorktreeManager.instance = new WorktreeManager(db, mainRepoPath);
    await WorktreeManager.instance.setupWorktrees();
    return WorktreeManager.instance;
  }

  private constructor(db: DatabaseManager, mainRepoPath: string) {
    this.db = db;
    this.mainRepoPath = mainRepoPath;
    this.git = simpleGit(mainRepoPath);

    // Create worktree base directory in a temp location
    this.worktreeBaseDir = path.join(os.tmpdir(), 'duckling-worktrees');
    this.ensureWorktreeBaseDir();
  }

  private ensureWorktreeBaseDir(): void {
    if (!fs.existsSync(this.worktreeBaseDir)) {
      fs.mkdirSync(this.worktreeBaseDir, { recursive: true });
      logger.info(`Created worktree base directory: ${this.worktreeBaseDir}`);
    }
  }

  private async setupWorktrees(): Promise<void> {
    logger.info('Setting up worktree pool...');

    // Clean up any existing worktrees
    await this.cleanupExistingWorktrees();

    // Create the initial pool of worktrees
    for (let i = 0; i < this.maxWorktrees; i++) {
      const worktreeId = `worktree-${i + 1}`;
      const worktreePath = path.join(this.worktreeBaseDir, worktreeId);

      await this.createWorktree(worktreeId, worktreePath);
    }

    logger.info(
      `Worktree pool initialized with ${this.maxWorktrees} worktrees`
    );
  }

  private async cleanupExistingWorktrees(): Promise<void> {
    try {
      // List existing worktrees
      const worktreeList = await this.git.raw([
        'worktree',
        'list',
        '--porcelain',
      ]);
      const worktreeEntries = worktreeList
        .split('\n\n')
        .filter((entry) => entry.trim());

      for (const entry of worktreeEntries) {
        const lines = entry.trim().split('\n');
        const worktreePath = lines[0].replace('worktree ', '');

        // Skip the main worktree
        if (worktreePath === this.mainRepoPath) {
          continue;
        }

        // Remove worktree if it's in our managed directory
        if (worktreePath.startsWith(this.worktreeBaseDir)) {
          logger.info(`Removing existing worktree: ${worktreePath}`);
          await this.git.raw(['worktree', 'remove', '--force', worktreePath]);
        }
      }

      // Clean up the base directory
      if (fs.existsSync(this.worktreeBaseDir)) {
        fs.rmSync(this.worktreeBaseDir, { recursive: true, force: true });
      }
      this.ensureWorktreeBaseDir();
    } catch (error) {
      logger.warn(`Error during worktree cleanup: ${error}`);
    }
  }

  private async createWorktree(
    id: string,
    worktreePath: string
  ): Promise<void> {
    try {
      // Get the default branch
      const defaultBranch = await this.getDefaultBranch();

      // Create the worktree
      await this.git.raw(['worktree', 'add', worktreePath, defaultBranch]);

      const worktree: Worktree = {
        id,
        path: worktreePath,
        inUse: false,
        createdAt: new Date(),
      };

      this.worktrees.set(id, worktree);
      logger.info(`Created worktree: ${id} at ${worktreePath}`);
    } catch (error) {
      logger.error(`Failed to create worktree ${id}: ${error}`);
      throw error;
    }
  }

  private async getDefaultBranch(): Promise<string> {
    try {
      const remoteInfo = await this.git.raw([
        'symbolic-ref',
        'refs/remotes/origin/HEAD',
      ]);
      return remoteInfo.replace('refs/remotes/origin/', '').trim();
    } catch {
      // Fallback to 'main' if we can't determine the default branch
      return 'main';
    }
  }

  async acquireWorktree(taskId: number): Promise<WorktreeAcquisition> {
    return new Promise((resolve, reject) => {
      // Try to get an available worktree immediately
      const availableWorktree = this.getAvailableWorktree();

      if (availableWorktree) {
        availableWorktree.inUse = true;
        availableWorktree.taskId = taskId;

        logger.info(
          `Acquired worktree ${availableWorktree.id} for task ${taskId}`
        );

        resolve({
          worktree: availableWorktree,
          release: () => this.releaseWorktree(availableWorktree.id),
        });
      } else {
        // Add to queue
        this.acquisitionQueue.push({ resolve, reject, taskId });
        logger.info(
          `Task ${taskId} queued for worktree (queue length: ${this.acquisitionQueue.length})`
        );
      }
    });
  }

  private getAvailableWorktree(): Worktree | null {
    for (const worktree of this.worktrees.values()) {
      if (!worktree.inUse) {
        return worktree;
      }
    }
    return null;
  }

  private async releaseWorktree(worktreeId: string): Promise<void> {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) {
      logger.error(`Worktree ${worktreeId} not found`);
      return;
    }

    try {
      // Clean up the worktree
      await this.cleanupWorktree(worktree);

      // Mark as available
      worktree.inUse = false;
      worktree.taskId = undefined;
      worktree.branchName = undefined;

      logger.info(`Released worktree ${worktreeId}`);

      // Process the queue
      this.processQueue();
    } catch (error) {
      logger.error(`Error releasing worktree ${worktreeId}: ${error}`);
      // Still mark as available to prevent permanent deadlock
      worktree.inUse = false;
      worktree.taskId = undefined;
      worktree.branchName = undefined;
    }
  }

  private async cleanupWorktree(worktree: Worktree): Promise<void> {
    const git = simpleGit(worktree.path);

    try {
      // Reset to clean state
      await git.reset(['--hard']);
      await git.clean('f', ['-d']);

      // Switch back to default branch
      const defaultBranch = await this.getDefaultBranch();
      await git.checkout(defaultBranch);

      // Pull latest changes
      await git.pull('origin', defaultBranch);
    } catch (error) {
      logger.warn(`Error cleaning worktree ${worktree.id}: ${error}`);
    }
  }

  private processQueue(): void {
    if (this.acquisitionQueue.length === 0) {
      return;
    }

    const availableWorktree = this.getAvailableWorktree();
    if (!availableWorktree) {
      return;
    }

    const queuedRequest = this.acquisitionQueue.shift()!;
    availableWorktree.inUse = true;
    availableWorktree.taskId = queuedRequest.taskId;

    logger.info(
      `Assigned queued task ${queuedRequest.taskId} to worktree ${availableWorktree.id}`
    );

    queuedRequest.resolve({
      worktree: availableWorktree,
      release: () => this.releaseWorktree(availableWorktree.id),
    });
  }

  getWorktreeStatus(): {
    total: number;
    available: number;
    inUse: number;
    queueLength: number;
    worktrees: Array<{
      id: string;
      path: string;
      inUse: boolean;
      taskId?: number;
      branchName?: string;
    }>;
  } {
    const worktreeList = Array.from(this.worktrees.values()).map((w) => ({
      id: w.id,
      path: w.path,
      inUse: w.inUse,
      taskId: w.taskId,
      branchName: w.branchName,
    }));

    return {
      total: this.worktrees.size,
      available: worktreeList.filter((w) => !w.inUse).length,
      inUse: worktreeList.filter((w) => w.inUse).length,
      queueLength: this.acquisitionQueue.length,
      worktrees: worktreeList,
    };
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down WorktreeManager...');

    try {
      // Clean up all worktrees
      for (const worktree of this.worktrees.values()) {
        if (worktree.inUse) {
          logger.warn(
            `Forcibly releasing worktree ${worktree.id} (was in use by task ${worktree.taskId})`
          );
        }
        await this.git.raw(['worktree', 'remove', '--force', worktree.path]);
      }

      // Remove the base directory
      if (fs.existsSync(this.worktreeBaseDir)) {
        fs.rmSync(this.worktreeBaseDir, { recursive: true, force: true });
      }

      this.worktrees.clear();
      this.acquisitionQueue.forEach((req) =>
        req.reject(new Error('WorktreeManager shutting down'))
      );
      this.acquisitionQueue.length = 0;

      logger.info('WorktreeManager shutdown complete');
    } catch (error) {
      logger.error(`Error during WorktreeManager shutdown: ${error}`);
    }
  }

  // Helper method to update worktree branch info
  updateWorktreeBranch(worktreeId: string, branchName: string): void {
    const worktree = this.worktrees.get(worktreeId);
    if (worktree) {
      worktree.branchName = branchName;
    }
  }
}
