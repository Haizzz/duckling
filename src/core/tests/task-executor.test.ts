import { TaskExecutor } from '../task-executor';

describe('TaskExecutor', () => {
  let taskExecutor: TaskExecutor;

  beforeEach(() => {
    taskExecutor = TaskExecutor.getInstance();
    
    // Clear any existing state
    (taskExecutor as any).currentOperation = null;
    (taskExecutor as any).operationQueue = [];
    (taskExecutor as any).isProcessing = false;
  });

  describe('getInstance', () => {
    it('returns same instance when called multiple times', () => {
      const instance1 = TaskExecutor.getInstance();
      const instance2 = TaskExecutor.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe('executeTask', () => {
    it('executes single task from queue and marks as completed', async () => {
      const mockExecute = jest.fn().mockResolvedValue(undefined);
      const operation = {
        taskId: 123,
        operation: 'test-operation',
        execute: mockExecute
      };

      await taskExecutor.executeTask(operation);

      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('executes task with database operations and calls mocked database methods', async () => {
      const mockDb = {
        updateTaskStatus: jest.fn(),
        addTaskLog: jest.fn(),
        getTask: jest.fn().mockResolvedValue({ id: 123 })
      };

      const mockExecute = jest.fn(async () => {
        mockDb.updateTaskStatus(123, 'in_progress');
        mockDb.addTaskLog({ taskId: 123, message: 'Task started' });
      });

      const operation = {
        taskId: 123,
        operation: 'database-operation',
        execute: mockExecute
      };

      await taskExecutor.executeTask(operation);

      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockDb.updateTaskStatus).toHaveBeenCalledWith(123, 'in_progress');
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({ taskId: 123, message: 'Task started' });
    });

    it('emits operation-start event when task begins execution', async () => {
      const startSpy = jest.fn();
      taskExecutor.on('operation-start', startSpy);
      
      const mockExecute = jest.fn().mockResolvedValue(undefined);
      const operation = {
        taskId: 123,
        operation: 'test-operation',
        execute: mockExecute
      };

      await taskExecutor.executeTask(operation);

      expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 123,
        operation: 'test-operation'
      }));
    });

    it('emits operation-complete event when task finishes successfully', async () => {
      const completeSpy = jest.fn();
      taskExecutor.on('operation-complete', completeSpy);
      
      const mockExecute = jest.fn().mockResolvedValue(undefined);
      const operation = {
        taskId: 123,
        operation: 'test-operation',
        execute: mockExecute
      };

      await taskExecutor.executeTask(operation);

      expect(completeSpy).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 123,
        operation: 'test-operation'
      }));
    });

    it('rejects promise when task execution fails', async () => {
      const error = new Error('Operation failed');
      const mockExecute = jest.fn(async () => {
        throw error;
      });
      
      const operation = {
        taskId: 123,
        operation: 'test-operation',
        execute: mockExecute
      };

      await expect(taskExecutor.executeTask(operation)).rejects.toThrow('Operation failed');
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('handles database errors properly during task execution', async () => {
      const mockDb = {
        updateTaskStatus: jest.fn().mockRejectedValue(new Error('Database error'))
      };

      const mockExecute = jest.fn(async () => {
        await mockDb.updateTaskStatus(123, 'failed');
      });

      const operation = {
        taskId: 123,
        operation: 'failing-database-operation',
        execute: mockExecute
      };

      await expect(taskExecutor.executeTask(operation)).rejects.toThrow('Database error');
      expect(mockDb.updateTaskStatus).toHaveBeenCalledWith(123, 'failed');
    });

    it('processes multiple tasks sequentially in queue order', async () => {
      const execute1 = jest.fn().mockResolvedValue(undefined);
      const execute2 = jest.fn().mockResolvedValue(undefined);

      const task1 = taskExecutor.executeTask({
        taskId: 1,
        operation: 'task1',
        execute: execute1
      });

      const task2 = taskExecutor.executeTask({
        taskId: 2,
        operation: 'task2', 
        execute: execute2
      });

      await Promise.all([task1, task2]);

      expect(execute1).toHaveBeenCalledTimes(1);
      expect(execute2).toHaveBeenCalledTimes(1);
    });

    it('executes multiple tasks with database operations in correct order', async () => {
      const mockDb = {
        updateTaskStatus: jest.fn(),
        addTaskLog: jest.fn()
      };

      const execute1 = jest.fn(async () => {
        mockDb.updateTaskStatus(1, 'in_progress');
        mockDb.addTaskLog({ taskId: 1, message: 'Task 1 started' });
      });

      const execute2 = jest.fn(async () => {
        mockDb.updateTaskStatus(2, 'in_progress');
        mockDb.addTaskLog({ taskId: 2, message: 'Task 2 started' });
      });

      const task1 = taskExecutor.executeTask({
        taskId: 1,
        operation: 'task1',
        execute: execute1
      });

      const task2 = taskExecutor.executeTask({
        taskId: 2,
        operation: 'task2',
        execute: execute2
      });

      await Promise.all([task1, task2]);

      expect(mockDb.updateTaskStatus).toHaveBeenCalledTimes(2);
      expect(mockDb.updateTaskStatus).toHaveBeenNthCalledWith(1, 1, 'in_progress');
      expect(mockDb.updateTaskStatus).toHaveBeenNthCalledWith(2, 2, 'in_progress');
      expect(mockDb.addTaskLog).toHaveBeenCalledTimes(2);
      expect(mockDb.addTaskLog).toHaveBeenNthCalledWith(1, { taskId: 1, message: 'Task 1 started' });
      expect(mockDb.addTaskLog).toHaveBeenNthCalledWith(2, { taskId: 2, message: 'Task 2 started' });
    });
  });

  describe('getCurrentOperation', () => {
    it('returns null when no operation is currently executing', () => {
      const current = taskExecutor.getCurrentOperation();
      expect(current).toBeNull();
    });
  });

  describe('getQueuedOperations', () => {
    it('returns empty array when operation queue is empty', () => {
      const queued = taskExecutor.getQueuedOperations();
      expect(queued).toEqual([]);
    });
  });

  describe('isTaskActive', () => {
    it('returns false when specified task is not currently active', () => {
      const isActive = taskExecutor.isTaskActive(123);
      expect(isActive).toBe(false);
    });
  });

  describe('getQueueLength', () => {
    it('returns zero when operation queue contains no items', () => {
      const length = taskExecutor.getQueueLength();
      expect(length).toBe(0);
    });
  });
});
