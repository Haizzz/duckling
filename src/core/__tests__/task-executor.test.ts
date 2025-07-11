import { TaskExecutor, TaskOperation } from '../task-executor';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

const mockLogger = logger as jest.Mocked<typeof logger>;

describe('TaskExecutor', () => {
  let taskExecutor: TaskExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    // Create a new instance for each test to avoid state pollution
    (TaskExecutor as any).instance = undefined;
    taskExecutor = TaskExecutor.getInstance();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = TaskExecutor.getInstance();
      const instance2 = TaskExecutor.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });

  describe('executeTask', () => {
    it('should execute a task operation', async () => {
      const mockExecute = jest.fn().mockResolvedValue(undefined);
      const operation: TaskOperation = {
        taskId: 1,
        operation: 'test-operation',
        execute: mockExecute,
      };

      await taskExecutor.executeTask(operation);

      expect(mockExecute).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Starting task operation: test-operation',
        '1'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Completed task operation: test-operation',
        '1'
      );
    });

    it('should handle task operation failure', async () => {
      const error = new Error('Task failed');
      const mockExecute = jest.fn().mockRejectedValue(error);
      const operation: TaskOperation = {
        taskId: 1,
        operation: 'test-operation',
        execute: mockExecute,
      };

      await expect(taskExecutor.executeTask(operation)).rejects.toThrow('Task failed');

      expect(mockExecute).toHaveBeenCalled();
      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed task operation: test-operation - Error: Task failed',
        '1'
      );
    });

    it('should emit events during task execution', async () => {
      const mockExecute = jest.fn().mockResolvedValue(undefined);
      const operation: TaskOperation = {
        taskId: 1,
        operation: 'test-operation',
        execute: mockExecute,
      };

      const startSpy = jest.fn();
      const completeSpy = jest.fn();
      taskExecutor.on('operation-start', startSpy);
      taskExecutor.on('operation-complete', completeSpy);

      await taskExecutor.executeTask(operation);

      expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 1,
        operation: 'test-operation',
      }));
      expect(completeSpy).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 1,
        operation: 'test-operation',
      }));
    });

    it('should emit error event on failure', async () => {
      const error = new Error('Task failed');
      const mockExecute = jest.fn().mockRejectedValue(error);
      const operation: TaskOperation = {
        taskId: 1,
        operation: 'test-operation',
        execute: mockExecute,
      };

      const errorSpy = jest.fn();
      taskExecutor.on('operation-error', errorSpy);

      await expect(taskExecutor.executeTask(operation)).rejects.toThrow('Task failed');

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 1,
        operation: 'test-operation',
      }), error);
    });
  });

  describe('Queue Management', () => {
    it('should execute tasks in order', async () => {
      const executionOrder: number[] = [];
      const operation1: TaskOperation = {
        taskId: 1,
        operation: 'operation-1',
        execute: async () => {
          executionOrder.push(1);
          await new Promise(resolve => setTimeout(resolve, 10));
        },
      };
      const operation2: TaskOperation = {
        taskId: 2,
        operation: 'operation-2',
        execute: async () => {
          executionOrder.push(2);
        },
      };

      // Start both operations
      const promise1 = taskExecutor.executeTask(operation1);
      const promise2 = taskExecutor.executeTask(operation2);

      await Promise.all([promise1, promise2]);

      expect(executionOrder).toEqual([1, 2]);
    });

    it('should not process multiple operations simultaneously', async () => {
      let operation1Running = false;
      let operation2Started = false;

      const operation1: TaskOperation = {
        taskId: 1,
        operation: 'operation-1',
        execute: async () => {
          operation1Running = true;
          await new Promise(resolve => setTimeout(resolve, 50));
          operation1Running = false;
        },
      };

      const operation2: TaskOperation = {
        taskId: 2,
        operation: 'operation-2',
        execute: async () => {
          operation2Started = true;
          // Operation 2 should not start while operation 1 is running
          expect(operation1Running).toBe(false);
        },
      };

      const promise1 = taskExecutor.executeTask(operation1);
      const promise2 = taskExecutor.executeTask(operation2);

      await Promise.all([promise1, promise2]);

      expect(operation2Started).toBe(true);
    });
  });

  describe('State Management', () => {
    it('should track current operation', async () => {
      expect(taskExecutor.getCurrentOperation()).toBeNull();

      const operation: TaskOperation = {
        taskId: 1,
        operation: 'test-operation',
        execute: async () => {
          expect(taskExecutor.getCurrentOperation()).toBeTruthy();
          expect(taskExecutor.getCurrentOperation()?.taskId).toBe(1);
        },
      };

      await taskExecutor.executeTask(operation);

      expect(taskExecutor.getCurrentOperation()).toBeNull();
    });

    it('should track queued operations', () => {
      const operation1: TaskOperation = {
        taskId: 1,
        operation: 'operation-1',
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
        },
      };

      const operation2: TaskOperation = {
        taskId: 2,
        operation: 'operation-2',
        execute: async () => {},
      };

      taskExecutor.executeTask(operation1);
      taskExecutor.executeTask(operation2);

      expect(taskExecutor.getQueueLength()).toBe(1); // operation1 is executing, operation2 is queued
      expect(taskExecutor.getQueuedOperations()).toHaveLength(1);
    });

    it('should check if task is active', () => {
      const operation1: TaskOperation = {
        taskId: 1,
        operation: 'operation-1',
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
        },
      };

      const operation2: TaskOperation = {
        taskId: 2,
        operation: 'operation-2',
        execute: async () => {},
      };

      taskExecutor.executeTask(operation1);
      taskExecutor.executeTask(operation2);

      expect(taskExecutor.isTaskActive(1)).toBe(true);
      expect(taskExecutor.isTaskActive(2)).toBe(true);
      expect(taskExecutor.isTaskActive(3)).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should continue processing queue after error', async () => {
      const operation1: TaskOperation = {
        taskId: 1,
        operation: 'failing-operation',
        execute: async () => {
          throw new Error('Operation failed');
        },
      };

      const operation2: TaskOperation = {
        taskId: 2,
        operation: 'successful-operation',
        execute: jest.fn().mockResolvedValue(undefined),
      };

      await expect(taskExecutor.executeTask(operation1)).rejects.toThrow('Operation failed');
      await taskExecutor.executeTask(operation2);

      expect(operation2.execute).toHaveBeenCalled();
    });

    it('should handle multiple errors', async () => {
      const operation1: TaskOperation = {
        taskId: 1,
        operation: 'failing-operation-1',
        execute: async () => {
          throw new Error('Operation 1 failed');
        },
      };

      const operation2: TaskOperation = {
        taskId: 2,
        operation: 'failing-operation-2',
        execute: async () => {
          throw new Error('Operation 2 failed');
        },
      };

      await expect(taskExecutor.executeTask(operation1)).rejects.toThrow('Operation 1 failed');
      await expect(taskExecutor.executeTask(operation2)).rejects.toThrow('Operation 2 failed');

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockLogger.error).toHaveBeenCalledTimes(2);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple executeTask calls', async () => {
      const operations: TaskOperation[] = [];
      const promises: Promise<void>[] = [];

      for (let i = 1; i <= 5; i++) {
        const operation: TaskOperation = {
          taskId: i,
          operation: `operation-${i}`,
          execute: jest.fn().mockResolvedValue(undefined),
        };
        operations.push(operation);
        promises.push(taskExecutor.executeTask(operation));
      }

      await Promise.all(promises);

      operations.forEach(op => {
        expect(op.execute).toHaveBeenCalled();
      });
    });
  });
});
