jest.mock('execa', () => ({
  execa: jest.fn().mockResolvedValue({
    stdout: 'success',
    stderr: '',
    exitCode: 0,
  }),
}));

import { PrecommitManager } from '../precommit-manager';
import { DatabaseManager } from '../database';
import { createMockInstance } from '../../utils/test-utils';
import * as execModule from '../../utils/exec';

describe('PrecommitManager', () => {
  let precommitManager: PrecommitManager;
  let mockDb: jest.Mocked<DatabaseManager>;

  beforeEach(() => {
    mockDb = createMockInstance(DatabaseManager);

    precommitManager = new PrecommitManager(mockDb);
  });

  describe('runChecks', () => {
    it('executes all precommit commands and returns passed true with no errors', async () => {
      const mockChecks = [
        {
          id: 1,
          name: 'lint',
          command: 'npm run lint',
          order_index: 1,
          created_at: '2023-01-01',
        },
        {
          id: 2,
          name: 'test',
          command: 'npm test',
          order_index: 2,
          created_at: '2023-01-01',
        },
      ];
      mockDb.getEnabledPrecommitChecks.mockReturnValue(mockChecks);

      const execSpy = jest
        .spyOn(execModule, 'execShellCommand')
        .mockResolvedValueOnce({
          stdout: 'lint passed',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: 'tests passed',
          stderr: '',
          exitCode: 0,
        });

      const result = await precommitManager.runChecks(123);

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(execSpy).toHaveBeenCalledWith(
        'npm run lint',
        expect.objectContaining({
          taskId: '123',
        })
      );
      expect(execSpy).toHaveBeenCalledWith(
        'npm test',
        expect.objectContaining({
          taskId: '123',
        })
      );
    });

    it('collects stderr messages from failed commands and returns passed false with error array', async () => {
      const mockChecks = [
        {
          id: 1,
          name: 'lint',
          command: 'npm run lint',
          order_index: 1,
          created_at: '2023-01-01',
        },
        {
          id: 2,
          name: 'format',
          command: 'npm run format',
          order_index: 2,
          created_at: '2023-01-01',
        },
      ];
      mockDb.getEnabledPrecommitChecks.mockReturnValue(mockChecks);

      // Mock will be called 4 times total (2 attempts x 2 checks)
      jest
        .spyOn(execModule, 'execShellCommand')
        .mockRejectedValueOnce(new Error('Linting failed: missing semicolon'))
        .mockRejectedValueOnce(new Error('Linting failed: missing semicolon'))
        .mockRejectedValueOnce(new Error('Format failed: wrong indentation'))
        .mockRejectedValueOnce(new Error('Format failed: wrong indentation'));

      const result = await precommitManager.runChecks(123);

      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain('lint:');
      expect(result.errors[1]).toContain('format:');
    });

    it('continues executing all checks when some fail', async () => {
      const mockChecks = [
        {
          id: 1,
          name: 'lint',
          command: 'npm run lint',
          order_index: 1,
          created_at: '2023-01-01',
        },
        {
          id: 2,
          name: 'test',
          command: 'npm test',
          order_index: 2,
          created_at: '2023-01-01',
        },
      ];
      mockDb.getEnabledPrecommitChecks.mockReturnValue(mockChecks);

      const execSpy = jest
        .spyOn(execModule, 'execShellCommand')
        .mockRejectedValueOnce(new Error('Lint failed'))
        .mockRejectedValueOnce(new Error('Lint failed'))
        .mockResolvedValueOnce({
          stdout: 'tests passed',
          stderr: '',
          exitCode: 0,
        });

      const result = await precommitManager.runChecks(123);

      expect(execSpy).toHaveBeenCalledWith('npm run lint', expect.any(Object));
      expect(execSpy).toHaveBeenCalledWith('npm test', expect.any(Object));
      expect(result.errors).toHaveLength(1);
    });

    it('calls addTaskLog with check name and passed status for each executed check', async () => {
      const mockChecks = [
        {
          id: 1,
          name: 'lint',
          command: 'npm run lint',
          order_index: 1,
          created_at: '2023-01-01',
        },
      ];
      mockDb.getEnabledPrecommitChecks.mockReturnValue(mockChecks);

      jest.spyOn(execModule, 'execShellCommand').mockResolvedValueOnce({
        stdout: 'lint passed',
        stderr: '',
        exitCode: 0,
      });

      await precommitManager.runChecks(123);

      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message: "Precommit check 'lint' passed",
      });
    });
  });

  describe('addCheck', () => {
    it('calls addPrecommitCheck with provided check object and returns generated ID', async () => {
      const newCheck = {
        name: 'security',
        command: 'npm audit',
        order_index: 5,
      };
      mockDb.addPrecommitCheck.mockReturnValue(1);

      const result = await precommitManager.addCheck(newCheck);

      expect(result).toBe(1);
      expect(mockDb.addPrecommitCheck).toHaveBeenCalledWith(newCheck);
    });
  });

  describe('updateCheck', () => {
    it('calls updatePrecommitCheck with check ID and update object', async () => {
      const updates = { command: 'npm run lint:fix' };

      await precommitManager.updateCheck(1, updates);

      expect(mockDb.updatePrecommitCheck).toHaveBeenCalledWith(1, updates);
    });
  });

  describe('deleteCheck', () => {
    it('calls deletePrecommitCheck with provided check ID', async () => {
      await precommitManager.deleteCheck(1);

      expect(mockDb.deletePrecommitCheck).toHaveBeenCalledWith(1);
    });
  });

  describe('getAllChecks', () => {
    it('calls getAllPrecommitChecks and returns all check records from database', () => {
      const mockChecks = [
        {
          id: 2,
          name: 'test',
          order_index: 2,
          command: 'npm test',
          created_at: '2023-01-01',
        },
        {
          id: 1,
          name: 'lint',
          order_index: 1,
          command: 'npm run lint',
          created_at: '2023-01-01',
        },
      ];
      mockDb.getAllPrecommitChecks.mockReturnValue(mockChecks);

      const result = precommitManager.getAllChecks();

      expect(result).toBe(mockChecks);
      expect(mockDb.getAllPrecommitChecks).toHaveBeenCalled();
    });
  });
});
