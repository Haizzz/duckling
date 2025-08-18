import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { WorktreeManager, WorktreeAcquisition } from './worktree-manager';

export interface TaskOperation {
  taskId: number;
  operation: string;
  execute: (worktreeAcquisition?: WorktreeAcquisition) => Promise<void>;
  requiresWorktree?: boolean;
}

export class TaskExecutor extends EventEmitter {
  private static instance: TaskExecutor;
  private activeOperations: Map<number, TaskOperation> = new Map();
  private worktreeManager: WorktreeManager | null = null;

  static getInstance(): TaskExecutor {
    if (!TaskExecutor.instance) {
      TaskExecutor.instance = new TaskExecutor();
    }
    return TaskExecutor.instance;
  }

  setWorktreeManager(worktreeManager: WorktreeManager): void {
    this.worktreeManager = worktreeManager;
  }

  async executeTask(operation: TaskOperation): Promise<void> {
    // Check if this task is already running
    if (this.activeOperations.has(operation.taskId)) {
      throw new Error(`Task ${operation.taskId} is already running`);
    }

    // Add to active operations
    this.activeOperations.set(operation.taskId, operation);

    logger.info(
      `Starting task operation: ${operation.operation}`,
      operation.taskId.toString()
    );
    this.emit('operation-start', operation);

    try {
      if (operation.requiresWorktree !== false && this.worktreeManager) {
        // Most operations require a worktree
        const acquisition = await this.worktreeManager.acquireWorktree(
          operation.taskId
        );

        try {
          await operation.execute(acquisition);
        } finally {
          // Always release the worktree
          await acquisition.release();
        }
      } else {
        // Operation doesn't require a worktree (like status updates)
        await operation.execute();
      }

      logger.info(
        `Completed task operation: ${operation.operation}`,
        operation.taskId.toString()
      );
      this.emit('operation-complete', operation);
    } catch (error) {
      logger.error(
        `Failed task operation: ${operation.operation} - ${error}`,
        operation.taskId.toString()
      );
      this.emit('operation-error', operation, error);
      throw error;
    } finally {
      // Remove from active operations
      this.activeOperations.delete(operation.taskId);
    }
  }

  getCurrentOperations(): TaskOperation[] {
    return Array.from(this.activeOperations.values());
  }

  getActiveTaskIds(): number[] {
    return Array.from(this.activeOperations.keys());
  }

  isTaskActive(taskId: number): boolean {
    return this.activeOperations.has(taskId);
  }

  getActiveOperationCount(): number {
    return this.activeOperations.size;
  }

  // Get the maximum number of concurrent operations (based on worktrees)
  getMaxConcurrentOperations(): number {
    if (!this.worktreeManager) {
      return 1; // Fallback to single operation
    }
    const status = this.worktreeManager.getWorktreeStatus();
    return status.total;
  }

  // Check if we can accept more operations
  canAcceptNewOperation(): boolean {
    return this.getActiveOperationCount() < this.getMaxConcurrentOperations();
  }

  // Get operation status for monitoring
  getOperationStatus(): {
    activeOperations: number;
    maxConcurrentOperations: number;
    canAcceptNew: boolean;
    activeTaskIds: number[];
    worktreeStatus?: any;
  } {
    return {
      activeOperations: this.getActiveOperationCount(),
      maxConcurrentOperations: this.getMaxConcurrentOperations(),
      canAcceptNew: this.canAcceptNewOperation(),
      activeTaskIds: this.getActiveTaskIds(),
      worktreeStatus: this.worktreeManager?.getWorktreeStatus(),
    };
  }
}

export const taskExecutor = TaskExecutor.getInstance();
