import {
  isGitHubCLIAvailable,
  executeGitHubCLI,
} from '../../utils/github-cli-utils';
import { execCommand } from '../../utils/exec';
import { logger } from '../../utils/logger';

// Mock exec command
jest.mock('../../utils/exec');
const mockExecCommand = execCommand as jest.MockedFunction<typeof execCommand>;

// Mock logger
jest.mock('../../utils/logger');
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('github-cli-utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isGitHubCLIAvailable', () => {
    it('should return true when GitHub CLI is installed and authenticated', async () => {
      mockExecCommand
        .mockResolvedValueOnce({
          stdout: 'gh version 2.0.0',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: 'Logged in to github.com as user',
          stderr: '',
          exitCode: 0,
        });

      const result = await isGitHubCLIAvailable();

      expect(result).toBe(true);
      expect(mockExecCommand).toHaveBeenCalledWith('gh', ['--version']);
      expect(mockExecCommand).toHaveBeenCalledWith('gh', ['auth', 'status']);
    });

    it('should return false when GitHub CLI is not installed', async () => {
      mockExecCommand.mockRejectedValue(new Error('Command not found'));

      const result = await isGitHubCLIAvailable();

      expect(result).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'GitHub CLI not installed:',
        'Error: Command not found'
      );
    });

    it('should return false when GitHub CLI is installed but not authenticated', async () => {
      mockExecCommand
        .mockResolvedValueOnce({
          stdout: 'gh version 2.0.0',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: 'Not logged in',
          stderr: '',
          exitCode: 1,
        });

      const result = await isGitHubCLIAvailable();

      expect(result).toBe(false);
      expect(mockExecCommand).toHaveBeenCalledWith('gh', ['--version']);
      expect(mockExecCommand).toHaveBeenCalledWith('gh', ['auth', 'status']);
    });

    it('should return false when auth status throws an error', async () => {
      mockExecCommand
        .mockResolvedValueOnce({
          stdout: 'gh version 2.0.0',
          stderr: '',
          exitCode: 0,
        })
        .mockRejectedValueOnce(new Error('Auth failed'));

      const result = await isGitHubCLIAvailable();

      expect(result).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'GitHub CLI not authenticated:',
        'Error: Auth failed'
      );
    });
  });

  describe('executeGitHubCLI', () => {
    it('should execute GitHub CLI command successfully', async () => {
      mockExecCommand.mockResolvedValue({
        stdout: 'Command output',
        stderr: '',
        exitCode: 0,
      });

      const result = await executeGitHubCLI('pr list');

      expect(result).toEqual({
        stdout: 'Command output',
        stderr: '',
      });
      expect(mockExecCommand).toHaveBeenCalledWith('gh', ['pr', 'list']);
    });

    it('should handle GitHub CLI command with stderr', async () => {
      mockExecCommand.mockResolvedValue({
        stdout: '',
        stderr: 'Warning message',
        exitCode: 0,
      });

      const result = await executeGitHubCLI('repo view');

      expect(result).toEqual({
        stdout: '',
        stderr: 'Warning message',
      });
      expect(mockExecCommand).toHaveBeenCalledWith('gh', ['repo', 'view']);
    });

    it('should handle GitHub CLI command failure', async () => {
      const error = new Error('Command failed');
      mockExecCommand.mockRejectedValue(error);

      await expect(executeGitHubCLI('invalid command')).rejects.toThrow(
        'Command failed'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'GitHub CLI command failed:',
        'Command failed'
      );
      expect(mockExecCommand).toHaveBeenCalledWith('gh', [
        'invalid',
        'command',
      ]);
    });

    it('should handle complex GitHub CLI commands', async () => {
      mockExecCommand.mockResolvedValue({
        stdout: 'PR created',
        stderr: '',
        exitCode: 0,
      });

      const result = await executeGitHubCLI(
        'pr create --title "Test PR" --body "Test body"'
      );

      expect(result).toEqual({
        stdout: 'PR created',
        stderr: '',
      });
      expect(mockExecCommand).toHaveBeenCalledWith('gh', [
        'pr',
        'create',
        '--title',
        '"Test',
        'PR"',
        '--body',
        '"Test',
        'body"',
      ]);
    });

    it('should handle empty commands', async () => {
      mockExecCommand.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await executeGitHubCLI('');

      expect(result).toEqual({
        stdout: '',
        stderr: '',
      });
      expect(mockExecCommand).toHaveBeenCalledWith('gh', ['']);
    });
  });
});
