import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export interface TaskOperation {
  taskId: number;
  operation: string;
  execute: () => Promise<void>;
}

export class TaskExecutor extends EventEmitter {
  private static instance: TaskExecutor;
  private runningOperations: Map<number, TaskOperation> = new Map();
  private operationQueue: TaskOperation[] = [];
  private maxConcurrentTasks = 5; // Allow up to 5 concurrent tasks

  static getInstance(): TaskExecutor {
    if (!TaskExecutor.instance) {
      TaskExecutor.instance = new TaskExecutor();
    }
    return TaskExecutor.instance;
  }

  async executeTask(operation: TaskOperation): Promise<void> {
    return new Promise((resolve, reject) => {
      const wrappedOperation: TaskOperation = {
        ...operation,
        execute: async () => {
          try {
            await operation.execute();
            resolve();
          } catch (error) {
            reject(error);
          }
        },
      };

      this.operationQueue.push(wrappedOperation);
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    // Start new tasks if we have capacity
    while (
      this.operationQueue.length > 0 &&
      this.runningOperations.size < this.maxConcurrentTasks
    ) {
      const operation = this.operationQueue.shift()!;

      // Check if this task is already running
      if (this.runningOperations.has(operation.taskId)) {
        continue; // Skip if task is already running
      }

      this.runningOperations.set(operation.taskId, operation);

      logger.info(
        `Starting task operation: ${operation.operation}`,
        operation.taskId.toString()
      );
      this.emit('operation-start', operation);

      // Execute the operation in parallel
      this.executeOperation(operation);
    }
  }

  private async executeOperation(operation: TaskOperation): Promise<void> {
    try {
      await operation.execute();
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
    } finally {
      // Remove from running operations
      this.runningOperations.delete(operation.taskId);

      // Process queue again to start any pending tasks
      this.processQueue();
    }
  }

  getCurrentOperations(): TaskOperation[] {
    return Array.from(this.runningOperations.values());
  }

  getQueuedOperations(): TaskOperation[] {
    return [...this.operationQueue];
  }

  isTaskActive(taskId: number): boolean {
    if (this.runningOperations.has(taskId)) {
      return true;
    }
    return this.operationQueue.some((op) => op.taskId === taskId);
  }

  getQueueLength(): number {
    return this.operationQueue.length;
  }

  getRunningTaskCount(): number {
    return this.runningOperations.size;
  }
}

export const taskExecutor = TaskExecutor.getInstance();
