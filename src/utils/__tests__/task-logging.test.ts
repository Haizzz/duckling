import { withTaskLogMessages } from '../task-logging';
import { db } from '../../core/database';

jest.mock('../../core/database', () => ({
  db: {
    addTaskLog: jest.fn(),
  },
}));

const mockDb = db as jest.Mocked<typeof db>;

describe('Task Logging', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('withTaskLogMessages', () => {
    it('should log start and complete messages for successful action', async () => {
      const mockAction = jest.fn().mockResolvedValue('success');
      const options = {
        taskId: 1,
        startMessage: 'Starting task',
        completeMessage: 'Task completed',
        failureMessage: 'Task failed',
      };

      const result = await withTaskLogMessages(options, mockAction);

      expect(result).toBe('success');
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 1,
        level: 'info',
        message: 'Starting task',
      });
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 1,
        level: 'info',
        message: 'Task completed',
      });
      expect(mockAction).toHaveBeenCalled();
    });

    it('should log start and failure messages for failed action', async () => {
      const error = new Error('Test error');
      const mockAction = jest.fn().mockRejectedValue(error);
      const options = {
        taskId: 2,
        startMessage: 'Starting task',
        completeMessage: 'Task completed',
        failureMessage: 'Task failed',
      };

      await expect(withTaskLogMessages(options, mockAction)).rejects.toThrow('Test error');

      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 2,
        level: 'info',
        message: 'Starting task',
      });
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 2,
        level: 'error',
        message: 'Task failed: Test error',
      });
      expect(mockAction).toHaveBeenCalled();
    });

    it('should handle non-Error objects', async () => {
      const mockAction = jest.fn().mockRejectedValue('String error');
      const options = {
        taskId: 3,
        startMessage: 'Starting task',
        completeMessage: 'Task completed',
        failureMessage: 'Task failed',
      };

      await expect(withTaskLogMessages(options, mockAction)).rejects.toBe('String error');

      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 3,
        level: 'error',
        message: 'Task failed: String error',
      });
    });

    it('should return the action result', async () => {
      const mockAction = jest.fn().mockResolvedValue({ data: 'test' });
      const options = {
        taskId: 4,
        startMessage: 'Starting task',
        completeMessage: 'Task completed',
        failureMessage: 'Task failed',
      };

      const result = await withTaskLogMessages(options, mockAction);

      expect(result).toEqual({ data: 'test' });
    });
  });
});
