import { withTaskLogMessages } from '../../utils/task-logging';
import { db } from '../../core/database';

// Mock database
jest.mock('../../core/database');
const mockDb = db as jest.Mocked<typeof db>;

describe('withTaskLogMessages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should log start and complete messages on success', async () => {
    const mockAction = jest.fn().mockResolvedValue('success result');
    const options = {
      taskId: 123,
      startMessage: 'Starting task',
      completeMessage: 'Task completed',
      failureMessage: 'Task failed',
    };

    const result = await withTaskLogMessages(options, mockAction);

    expect(result).toBe('success result');
    expect(mockAction).toHaveBeenCalledTimes(1);

    expect(mockDb.addTaskLog).toHaveBeenCalledWith({
      task_id: 123,
      level: 'info',
      message: 'Starting task',
    });

    expect(mockDb.addTaskLog).toHaveBeenCalledWith({
      task_id: 123,
      level: 'info',
      message: 'Task completed',
    });

    expect(mockDb.addTaskLog).toHaveBeenCalledTimes(2);
  });

  it('should log start and failure messages on error', async () => {
    const error = new Error('Test error');
    const mockAction = jest.fn().mockRejectedValue(error);
    const options = {
      taskId: 456,
      startMessage: 'Starting task',
      completeMessage: 'Task completed',
      failureMessage: 'Task failed',
    };

    await expect(withTaskLogMessages(options, mockAction)).rejects.toThrow(
      'Test error'
    );

    expect(mockAction).toHaveBeenCalledTimes(1);

    expect(mockDb.addTaskLog).toHaveBeenCalledWith({
      task_id: 456,
      level: 'info',
      message: 'Starting task',
    });

    expect(mockDb.addTaskLog).toHaveBeenCalledWith({
      task_id: 456,
      level: 'error',
      message: 'Task failed: Test error',
    });

    expect(mockDb.addTaskLog).toHaveBeenCalledTimes(2);
  });

  it('should handle non-Error objects thrown', async () => {
    const mockAction = jest.fn().mockRejectedValue('string error');
    const options = {
      taskId: 789,
      startMessage: 'Starting task',
      completeMessage: 'Task completed',
      failureMessage: 'Task failed',
    };

    await expect(withTaskLogMessages(options, mockAction)).rejects.toBe(
      'string error'
    );

    expect(mockDb.addTaskLog).toHaveBeenCalledWith({
      task_id: 789,
      level: 'error',
      message: 'Task failed: string error',
    });
  });

  it('should handle actions that return different types', async () => {
    const mockAction = jest.fn().mockResolvedValue({ data: 'object result' });
    const options = {
      taskId: 101,
      startMessage: 'Starting task',
      completeMessage: 'Task completed',
      failureMessage: 'Task failed',
    };

    const result = await withTaskLogMessages(options, mockAction);

    expect(result).toEqual({ data: 'object result' });
    expect(mockDb.addTaskLog).toHaveBeenCalledTimes(2);
  });

  it('should handle undefined and null error values', async () => {
    const mockAction = jest.fn().mockRejectedValue(null);
    const options = {
      taskId: 202,
      startMessage: 'Starting task',
      completeMessage: 'Task completed',
      failureMessage: 'Task failed',
    };

    await expect(withTaskLogMessages(options, mockAction)).rejects.toBeNull();

    expect(mockDb.addTaskLog).toHaveBeenCalledWith({
      task_id: 202,
      level: 'error',
      message: 'Task failed: null',
    });
  });
});
