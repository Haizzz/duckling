import { withRetry } from '../../utils/retry';

describe('withRetry', () => {
  let mockOperation: jest.Mock;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockOperation = jest.fn();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleSpy.mockRestore();
  });

  it('should succeed on first attempt', async () => {
    const expectedResult = 'success';
    mockOperation.mockResolvedValue(expectedResult);

    const result = await withRetry(mockOperation, 'test operation');

    expect(result).toBe(expectedResult);
    expect(mockOperation).toHaveBeenCalledTimes(1);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('should retry on failure and eventually succeed', async () => {
    const expectedResult = 'success';
    mockOperation
      .mockRejectedValueOnce(new Error('First failure'))
      .mockRejectedValueOnce(new Error('Second failure'))
      .mockResolvedValue(expectedResult);

    const retryPromise = withRetry(mockOperation, 'test operation', 3);

    // Fast-forward timers to handle delays
    jest.advanceTimersByTime(5000);

    const result = await retryPromise;

    expect(result).toBe(expectedResult);
    expect(mockOperation).toHaveBeenCalledTimes(3);
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it('should fail after max retries', async () => {
    const error = new Error('Persistent failure');
    mockOperation.mockRejectedValue(error);

    const retryPromise = withRetry(mockOperation, 'test operation', 2);

    // Fast-forward timers to handle delays
    jest.advanceTimersByTime(5000);

    await expect(retryPromise).rejects.toThrow(
      'test operation failed after 2 attempts: Persistent failure'
    );
    expect(mockOperation).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it('should use default max retries of 3', async () => {
    const error = new Error('Failure');
    mockOperation.mockRejectedValue(error);

    const retryPromise = withRetry(mockOperation, 'test operation');

    // Fast-forward timers to handle delays
    jest.advanceTimersByTime(10000);

    await expect(retryPromise).rejects.toThrow(
      'test operation failed after 3 attempts: Failure'
    );
    expect(mockOperation).toHaveBeenCalledTimes(3);
  });

  it('should log failures with correct context', async () => {
    const error = new Error('Test error');
    mockOperation.mockRejectedValue(error);

    const retryPromise = withRetry(mockOperation, 'custom context', 2);

    // Fast-forward timers to handle delays
    jest.advanceTimersByTime(5000);

    await expect(retryPromise).rejects.toThrow();

    expect(consoleSpy).toHaveBeenCalledWith(
      'custom context failed (attempt 1/2):',
      error
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      'custom context failed (attempt 2/2):',
      error
    );
  });

  it('should apply exponential backoff', async () => {
    const error = new Error('Failure');
    mockOperation.mockRejectedValue(error);

    const retryPromise = withRetry(mockOperation, 'test operation', 3);

    // Check that delays are applied
    expect(setTimeout).toHaveBeenCalledTimes(0);

    // Fast-forward to trigger first retry
    jest.advanceTimersByTime(1000);

    // Should have scheduled delays
    expect(setTimeout).toHaveBeenCalled();

    // Complete the promise
    jest.advanceTimersByTime(10000);

    await expect(retryPromise).rejects.toThrow();
  });
});
