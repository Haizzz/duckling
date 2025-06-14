import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export interface TaskOperation {
  taskId: string;
  operation: string;
  execute: () => Promise<void>;
}

export class TaskExecutor extends EventEmitter {
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
          } catch (error) {
            reject(error);
          }
        }
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
      
      logger.info(`Starting task operation: ${operation.operation}`, operation.taskId);
      this.emit('operation-start', operation);
      
      try {
        await operation.execute();
        logger.info(`Completed task operation: ${operation.operation}`, operation.taskId);
        this.emit('operation-complete', operation);
      } catch (error) {
        logger.error(`Failed task operation: ${operation.operation} - ${error}`, operation.taskId);
        this.emit('operation-error', operation, error);
      }
      
      this.currentOperation = null;
    }
    
    this.isProcessing = false;
  }

  getCurrentOperation(): TaskOperation | null {
    return this.currentOperation;
  }

  getQueuedOperations(): TaskOperation[] {
    return [...this.operationQueue];
  }

  isTaskActive(taskId: string): boolean {
    if (this.currentOperation?.taskId === taskId) {
      return true;
    }
    return this.operationQueue.some(op => op.taskId === taskId);
  }

  getQueueLength(): number {
    return this.operationQueue.length;
  }
}

export const taskExecutor = TaskExecutor.getInstance();
