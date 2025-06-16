jest.mock('execa', () => ({
  execa: jest.fn().mockResolvedValue({
    stdout: 'success',
    stderr: '',
    exitCode: 0,
  }),
}));

import { CodingManager } from '../coding-manager';
import * as execModule from '../../utils/exec';
import { DatabaseManager } from '../database';
import { createMockInstance } from '../../utils/test-utils';

describe('CodingManager', () => {
  let codingManager: CodingManager;
  let mockDb: jest.Mocked<DatabaseManager>;

  beforeEach(() => {
    mockDb = createMockInstance(DatabaseManager);
    codingManager = new CodingManager(mockDb);
  });

  describe('generateCode', () => {
    it('calls amp CLI with API key environment variable and task ID when amp tool configured', async () => {
      mockDb.getSetting.mockReturnValue({
        key: 'ampApiKey',
        value: 'amp-key-123',
        updated_at: new Date().toISOString(),
      });

      const whichSpy = jest.spyOn(execModule, 'execCommand').mockResolvedValue({
        stdout: '/usr/local/bin/amp',
        stderr: '',
        exitCode: 0,
      });

      const execSpy = jest
        .spyOn(execModule, 'execCommandWithInput')
        .mockResolvedValue({
          stdout: 'Generated code',
          stderr: '',
          exitCode: 0,
        });

      const result = await codingManager.generateCode(
        'amp',
        'Create a function',
        {
          taskId: 123,
          repositoryPath: '/test/repo',
        }
      );

      expect(result).toBe('Generated code');
      expect(mockDb.getSetting).toHaveBeenCalledWith('ampApiKey');
      expect(whichSpy).toHaveBeenCalledWith('which', ['amp'], {
        taskId: '123',
        cwd: '/test/repo',
      });
      expect(execSpy).toHaveBeenCalledWith(
        'amp',
        'Create a function',
        [],
        expect.objectContaining({
          taskId: '123',
          cwd: '/test/repo',
          env: expect.objectContaining({
            AMP_API_KEY: 'amp-key-123',
          }),
        })
      );
    });

    it('calls codex CLI with OpenAI API key and task prompt when openai tool configured', async () => {
      mockDb.getSetting.mockReturnValue({
        key: 'openaiApiKey',
        value: 'openai-key-456',
        updated_at: new Date().toISOString(),
      });

      const whichSpy = jest
        .spyOn(execModule, 'execCommand')
        .mockResolvedValueOnce({
          stdout: '/usr/local/bin/codex',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: 'AI generated code',
          stderr: '',
          exitCode: 0,
        });

      const result = await codingManager.generateCode(
        'openai',
        'Create a class',
        {
          taskId: 456,
          repositoryPath: '/test/repo',
        }
      );

      expect(result).toBe('AI generated code');
      expect(mockDb.getSetting).toHaveBeenCalledWith('openaiApiKey');
      expect(whichSpy).toHaveBeenCalledWith('which', ['codex'], {
        taskId: '456',
        cwd: '/test/repo',
      });
      expect(whichSpy).toHaveBeenCalledWith(
        'codex',
        [
          '--disable-response-storage',
          '--auto-edit',
          '--quiet',
          '--full-stdout',
          'Create a class',
        ],
        expect.objectContaining({
          taskId: '456',
          cwd: '/test/repo',
          env: expect.objectContaining({
            OPENAI_API_KEY: 'openai-key-456',
          }),
        })
      );
    });

    it('throws error with specific message when API key not found in database', async () => {
      mockDb.getSetting.mockReturnValue(null);

      await expect(
        codingManager.generateCode('amp', 'task', {
          taskId: 123,
          repositoryPath: '/test/repo',
        })
      ).rejects.toThrow('Amp API key not configured');

      expect(mockDb.getSetting).toHaveBeenCalledWith('ampApiKey');
    });

    it('throws error from stderr when CLI command returns non-zero exit code', async () => {
      mockDb.getSetting.mockReturnValue({
        key: 'ampApiKey',
        value: 'amp-key',
        updated_at: new Date().toISOString(),
      });

      jest.spyOn(execModule, 'execCommand').mockResolvedValue({
        stdout: '/usr/local/bin/amp',
        stderr: '',
        exitCode: 0,
      });

      jest.spyOn(execModule, 'execCommandWithInput').mockResolvedValue({
        stdout: '',
        stderr: 'Command failed',
        exitCode: 1,
      });

      await expect(
        codingManager.generateCode('amp', 'task', {
          taskId: 123,
          repositoryPath: '/test/repo',
        })
      ).rejects.toThrow('Command failed');

      expect(mockDb.getSetting).toHaveBeenCalledWith('ampApiKey');
    });

    it('throws CLI not found error when which command fails with ENOENT', async () => {
      mockDb.getSetting.mockReturnValue({
        key: 'ampApiKey',
        value: 'amp-key',
        updated_at: new Date().toISOString(),
      });

      const error = new Error('Command failed') as any;
      error.code = 'ENOENT';

      jest.spyOn(execModule, 'execCommand').mockRejectedValue(error);

      await expect(
        codingManager.generateCode('amp', 'task', {
          taskId: 123,
          repositoryPath: '/test/repo',
        })
      ).rejects.toThrow('Amp CLI not found');

      expect(mockDb.getSetting).toHaveBeenCalledWith('ampApiKey');
    });
  });

  describe('requestFixes', () => {
    it('calls generateCode with original task and concatenated error messages', async () => {
      const generateCodeSpy = jest
        .spyOn(codingManager, 'generateCode')
        .mockResolvedValue('Fixed code');

      const errors = ['Missing semicolon', 'Wrong indentation'];
      const result = await codingManager.requestFixes(
        'amp',
        'Original task',
        errors,
        { taskId: 789, repositoryPath: '/test/repo' }
      );

      expect(result).toBe('Fixed code');
      expect(generateCodeSpy).toHaveBeenCalledWith(
        'amp',
        expect.stringContaining('Original request: Original task'),
        { taskId: 789, repositoryPath: '/test/repo' }
      );
      expect(generateCodeSpy).toHaveBeenCalledWith(
        'amp',
        expect.stringContaining('Missing semicolon'),
        { taskId: 789, repositoryPath: '/test/repo' }
      );
    });
  });
});
