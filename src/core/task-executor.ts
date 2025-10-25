import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { toMessage } from '../utils/error-utils';

interface TaskOperation {
  taskId: number;
  operation: string;
  execute: () => Promise<void>;
}

class TaskExecutor extends EventEmitter {
  private static instance: TaskExecutor;
  private currentOperation: TaskOperation | null = null;
  private operationQueue: TaskOperation[] = [];
  private isProcessing = false;

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
          } catch (error: unknown) {
            reject(error);
          }
        },
      };

      this.operationQueue.push(wrappedOperation);
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.operationQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.operationQueue.length > 0) {
      const operation = this.operationQueue.shift()!;
      this.currentOperation = operation;

      logger.info(
        `Starting task operation: ${operation.operation}`,
        operation.taskId.toString()
      );
      this.emit('operation-start', operation);

      try {
        await operation.execute();
        logger.info(
          `Completed task operation: ${operation.operation}`,
          operation.taskId.toString()
        );
        this.emit('operation-complete', operation);
      } catch (error: unknown) {
        logger.error(
          `Failed task operation: ${operation.operation} - ${toMessage(error)}`,
          operation.taskId.toString()
        );
        this.emit('operation-error', operation, error);
      }

      this.currentOperation = null;
    }

    this.isProcessing = false;
  }

  isTaskActive(taskId: number): boolean {
    if (this.currentOperation?.taskId === taskId) {
      return true;
    }
    return this.operationQueue.some((op) => op.taskId === taskId);
  }
}

export const taskExecutor = TaskExecutor.getInstance();
