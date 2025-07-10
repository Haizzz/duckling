import { TaskExecutor, TaskOperation } from '../../core/task-executor';
import { logger } from '../../utils/logger';

// Mock logger
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

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = TaskExecutor.getInstance();
      const instance2 = TaskExecutor.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe('executeTask', () => {
    it('should execute a task operation successfully', async () => {
      const mockExecute = jest.fn().mockResolvedValue(undefined);
      const operation: TaskOperation = {
        taskId: 123,
        operation: 'test-operation',
        execute: mockExecute,
      };

      const operationStartSpy = jest.fn();
      const operationCompleteSpy = jest.fn();
      taskExecutor.on('operation-start', operationStartSpy);
      taskExecutor.on('operation-complete', operationCompleteSpy);

      await taskExecutor.executeTask(operation);

      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(operationStartSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 123,
          operation: 'test-operation',
        })
      );
      expect(operationCompleteSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 123,
          operation: 'test-operation',
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Starting task operation: test-operation',
        '123'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Completed task operation: test-operation',
        '123'
      );
    });

    it('should handle task operation failure', async () => {
      const error = new Error('Test error');
      const mockExecute = jest.fn().mockRejectedValue(error);
      const operation: TaskOperation = {
        taskId: 456,
        operation: 'failing-operation',
        execute: mockExecute,
      };

      const operationErrorSpy = jest.fn();
      taskExecutor.on('operation-error', operationErrorSpy);

      await expect(taskExecutor.executeTask(operation)).rejects.toThrow(
        'Test error'
      );

      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(operationErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 456,
          operation: 'failing-operation',
        }),
        error
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed task operation: failing-operation - Error: Test error',
        '456'
      );
    });

    it('should process tasks sequentially', async () => {
      const executionOrder: number[] = [];
      const createOperation = (
        taskId: number,
        delay: number
      ): TaskOperation => ({
        taskId,
        operation: `operation-${taskId}`,
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, delay));
          executionOrder.push(taskId);
        },
      });

      const operation1 = createOperation(1, 50);
      const operation2 = createOperation(2, 10);
      const operation3 = createOperation(3, 30);

      // Start all operations simultaneously
      const promises = [
        taskExecutor.executeTask(operation1),
        taskExecutor.executeTask(operation2),
        taskExecutor.executeTask(operation3),
      ];

      await Promise.all(promises);

      // Despite operation2 having the shortest delay, they should execute in order
      expect(executionOrder).toEqual([1, 2, 3]);
    });
  });

  describe('getCurrentOperation', () => {
    it('should return current operation when processing', async () => {
      const operation: TaskOperation = {
        taskId: 123,
        operation: 'test-operation',
        execute: async () => {
          // Check current operation during execution
          const current = taskExecutor.getCurrentOperation();
          expect(current).toEqual(
            expect.objectContaining({
              taskId: 123,
              operation: 'test-operation',
            })
          );
        },
      };

      await taskExecutor.executeTask(operation);

      // Should be null after completion
      expect(taskExecutor.getCurrentOperation()).toBeNull();
    });

    it('should return null when no operation is running', () => {
      expect(taskExecutor.getCurrentOperation()).toBeNull();
    });
  });

  describe('getQueuedOperations', () => {
    it('should return queued operations', async () => {
      const longRunningOperation: TaskOperation = {
        taskId: 1,
        operation: 'long-running',
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
        },
      };

      const queuedOperation: TaskOperation = {
        taskId: 2,
        operation: 'queued',
        execute: async () => {},
      };

      // Start long-running operation
      const promise1 = taskExecutor.executeTask(longRunningOperation);

      // Add queued operation
      const promise2 = taskExecutor.executeTask(queuedOperation);

      // Check queue immediately
      const queued = taskExecutor.getQueuedOperations();
      expect(queued).toHaveLength(1);
      expect(queued[0]).toEqual(
        expect.objectContaining({
          taskId: 2,
          operation: 'queued',
        })
      );

      await Promise.all([promise1, promise2]);

      // Queue should be empty after completion
      expect(taskExecutor.getQueuedOperations()).toHaveLength(0);
    });
  });

  describe('isTaskActive', () => {
    it('should return true for currently running task', async () => {
      const operation: TaskOperation = {
        taskId: 123,
        operation: 'test-operation',
        execute: async () => {
          expect(taskExecutor.isTaskActive(123)).toBe(true);
          expect(taskExecutor.isTaskActive(456)).toBe(false);
        },
      };

      await taskExecutor.executeTask(operation);

      expect(taskExecutor.isTaskActive(123)).toBe(false);
    });

    it('should return true for queued task', async () => {
      const longRunningOperation: TaskOperation = {
        taskId: 1,
        operation: 'long-running',
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        },
      };

      const queuedOperation: TaskOperation = {
        taskId: 2,
        operation: 'queued',
        execute: async () => {},
      };

      const promise1 = taskExecutor.executeTask(longRunningOperation);
      const promise2 = taskExecutor.executeTask(queuedOperation);

      expect(taskExecutor.isTaskActive(1)).toBe(true);
      expect(taskExecutor.isTaskActive(2)).toBe(true);
      expect(taskExecutor.isTaskActive(3)).toBe(false);

      await Promise.all([promise1, promise2]);
    });

    it('should return false for non-active task', () => {
      expect(taskExecutor.isTaskActive(999)).toBe(false);
    });
  });

  describe('getQueueLength', () => {
    it('should return correct queue length', async () => {
      expect(taskExecutor.getQueueLength()).toBe(0);

      const longRunningOperation: TaskOperation = {
        taskId: 1,
        operation: 'long-running',
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        },
      };

      const queuedOperation1: TaskOperation = {
        taskId: 2,
        operation: 'queued-1',
        execute: async () => {},
      };

      const queuedOperation2: TaskOperation = {
        taskId: 3,
        operation: 'queued-2',
        execute: async () => {},
      };

      const promise1 = taskExecutor.executeTask(longRunningOperation);
      const promise2 = taskExecutor.executeTask(queuedOperation1);
      const promise3 = taskExecutor.executeTask(queuedOperation2);

      // Should have 2 queued operations (first one is running)
      expect(taskExecutor.getQueueLength()).toBe(2);

      await Promise.all([promise1, promise2, promise3]);

      expect(taskExecutor.getQueueLength()).toBe(0);
    });
  });
});
