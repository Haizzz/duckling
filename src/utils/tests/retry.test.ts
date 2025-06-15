import { withRetry, sleep, generateId } from '../retry';

describe('retry utils', () => {
  describe('withRetry', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('returns result on first successful attempt', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      const result = await withRetry(mockOperation, 'test operation');

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('retries operation up to 3 times and succeeds on third attempt', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      const result = await withRetry(mockOperation, 'test operation');

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    it('throws error after maxRetries attempts when operation keeps failing', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValue(new Error('persistent failure'));

      await expect(
        withRetry(mockOperation, 'test operation', 2)
      ).rejects.toThrow(
        'test operation failed after 2 attempts: persistent failure'
      );

      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it('waits between retry attempts using sleep', async () => {
      const sleepSpy = jest
        .spyOn(global, 'setTimeout')
        .mockImplementation((fn: any) => {
          fn();
          return {} as any;
        });

      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      await withRetry(mockOperation, 'test operation');

      expect(sleepSpy).toHaveBeenCalled();
      sleepSpy.mockRestore();
    });
  });

  describe('sleep', () => {
    it('resolves after specified milliseconds', async () => {
      const start = Date.now();
      await sleep(10);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(5);
    });
  });

  describe('generateId', () => {
    it('generates unique string identifiers', () => {
      const id1 = generateId();
      const id2 = generateId();

      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
      expect(id1.length).toBeGreaterThan(0);
    });
  });
});
