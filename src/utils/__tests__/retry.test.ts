import { withRetry } from '../retry';

describe('Retry Utility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
      if (typeof callback === 'function') {
        callback();
      }
      return {} as NodeJS.Timeout;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('withRetry', () => {
    it('should return result on successful operation', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const result = await withRetry(operation, 'test operation');

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockRejectedValueOnce(new Error('Second failure'))
        .mockResolvedValue('success');

      const result = await withRetry(operation, 'test operation');

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retries', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Always fails'));

      await expect(withRetry(operation, 'test operation', 2)).rejects.toThrow(
        'test operation failed after 2 attempts: Always fails'
      );
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should use default max retries of 3', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Always fails'));

      await expect(withRetry(operation, 'test operation')).rejects.toThrow(
        'test operation failed after 3 attempts: Always fails'
      );
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should log failures', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValue('success');

      await withRetry(operation, 'test operation');

      expect(console.log).toHaveBeenCalledWith(
        'test operation failed (attempt 1/3):',
        expect.any(Error)
      );
    });

    it('should handle different error types', async () => {
      const operation = jest.fn().mockRejectedValue('string error');

      await expect(withRetry(operation, 'test operation', 1)).rejects.toThrow(
        'test operation failed after 1 attempts: undefined'
      );
    });

    it('should handle undefined context', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));

      await expect(withRetry(operation, '', 1)).rejects.toThrow(
        ' failed after 1 attempts: Test error'
      );
    });
  });
});
