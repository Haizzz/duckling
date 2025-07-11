import { execa } from 'execa';
import { execCommand, execCommandWithInputStreaming, execCommandStreaming, execShellCommand } from '../exec';
import { logger } from '../logger';

jest.mock('execa');
jest.mock('../logger');

const mockExeca = execa as jest.MockedFunction<typeof execa>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('Exec Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('execCommand', () => {
    it('should execute command and return result', async () => {
      const mockResult = {
        stdout: 'test output',
        stderr: '',
        exitCode: 0,
      };

      mockExeca.mockResolvedValue(mockResult as any);

      const result = await execCommand('ls', ['-la']);

      expect(result).toEqual(mockResult);
      expect(mockExeca).toHaveBeenCalledWith('ls', ['-la'], {
        reject: false,
      });
      expect(mockLogger.logCommand).toHaveBeenCalledWith('ls', ['-la'], process.cwd(), undefined);
      expect(mockLogger.logCommandResult).toHaveBeenCalledWith('ls', 0, 'test output', '', undefined);
    });

    it('should handle command with options', async () => {
      const mockResult = {
        stdout: 'test output',
        stderr: '',
        exitCode: 0,
      };

      mockExeca.mockResolvedValue(mockResult as any);

      const result = await execCommand('ls', ['-la'], { cwd: '/test', taskId: 'task-1' });

      expect(result).toEqual(mockResult);
      expect(mockExeca).toHaveBeenCalledWith('ls', ['-la'], {
        reject: false,
        cwd: '/test',
      });
      expect(mockLogger.logCommand).toHaveBeenCalledWith('ls', ['-la'], '/test', 'task-1');
      expect(mockLogger.logCommandResult).toHaveBeenCalledWith('ls', 0, 'test output', '', 'task-1');
    });

    it('should handle command failure', async () => {
      const mockError = new Error('Command failed');
      (mockError as any).exitCode = 1;
      (mockError as any).stdout = 'error output';
      (mockError as any).stderr = 'error message';

      mockExeca.mockRejectedValue(mockError);

      await expect(execCommand('ls', ['-la'])).rejects.toThrow('Command failed');
      expect(mockLogger.logCommandResult).toHaveBeenCalledWith('ls', 1, 'error output', 'error message', undefined);
    });

    it('should handle command with non-zero exit code', async () => {
      const mockResult = {
        stdout: 'test output',
        stderr: 'warning',
        exitCode: 1,
      };

      mockExeca.mockResolvedValue(mockResult as any);

      const result = await execCommand('ls', ['-la']);

      expect(result).toEqual(mockResult);
      expect(mockLogger.logCommandResult).toHaveBeenCalledWith('ls', 1, 'test output', 'warning', undefined);
    });
  });

  describe('execCommandWithInputStreaming', () => {
    it('should execute command with input streaming', async () => {
      const mockSubprocess = {
        stdout: {
          on: jest.fn(),
        },
        stderr: {
          on: jest.fn(),
        },
        exitCode: 0,
      };

      mockExeca.mockReturnValue(mockSubprocess as any);

      const promise = execCommandWithInputStreaming('cat', 'test input', []);

      // Simulate the subprocess resolving
      setTimeout(() => {
        mockSubprocess.stdout.on.mock.calls.forEach(([event, callback]) => {
          if (event === 'data') {
            callback(Buffer.from('test output'));
          }
        });
      }, 0);

      // Mock the subprocess promise resolution
      const mockResult = Promise.resolve(mockSubprocess);
      mockExeca.mockReturnValue(mockResult as any);

      const result = await execCommandWithInputStreaming('cat', 'test input', []);

      expect(mockExeca).toHaveBeenCalledWith('cat', [], {
        reject: false,
        input: 'test input',
        stdio: 'pipe',
      });
      expect(mockLogger.logCommand).toHaveBeenCalledWith('cat', [], process.cwd(), undefined);
    });

    it('should handle streaming with taskId', async () => {
      const mockSubprocess = {
        stdout: {
          on: jest.fn(),
        },
        stderr: {
          on: jest.fn(),
        },
        exitCode: 0,
      };

      mockExeca.mockReturnValue(Promise.resolve(mockSubprocess) as any);

      await execCommandWithInputStreaming('cat', 'test input', [], { taskId: 'task-1' });

      expect(mockLogger.logCommand).toHaveBeenCalledWith('cat', [], process.cwd(), 'task-1');
    });
  });

  describe('execCommandStreaming', () => {
    it('should execute command with streaming', async () => {
      const mockSubprocess = {
        stdout: {
          on: jest.fn(),
        },
        stderr: {
          on: jest.fn(),
        },
        exitCode: 0,
      };

      mockExeca.mockReturnValue(Promise.resolve(mockSubprocess) as any);

      const result = await execCommandStreaming('ls', ['-la']);

      expect(mockExeca).toHaveBeenCalledWith('ls', ['-la'], {
        reject: false,
        stdio: 'pipe',
      });
      expect(mockLogger.logCommand).toHaveBeenCalledWith('ls', ['-la'], process.cwd(), undefined);
    });
  });

  describe('execShellCommand', () => {
    it('should execute shell command', async () => {
      const mockResult = {
        stdout: 'test output',
        stderr: '',
        exitCode: 0,
      };

      mockExeca.mockResolvedValue(mockResult as any);

      const result = await execShellCommand('ls -la');

      expect(result).toEqual(mockResult);
      expect(mockExeca).toHaveBeenCalledWith('bash', ['-c', 'ls -la'], {
        reject: false,
      });
      expect(mockLogger.logCommand).toHaveBeenCalledWith('bash', ['-c', 'ls -la'], process.cwd(), undefined);
    });

    it('should handle shell command with options', async () => {
      const mockResult = {
        stdout: 'test output',
        stderr: '',
        exitCode: 0,
      };

      mockExeca.mockResolvedValue(mockResult as any);

      const result = await execShellCommand('ls -la', { cwd: '/test', taskId: 'task-1' });

      expect(result).toEqual(mockResult);
      expect(mockExeca).toHaveBeenCalledWith('bash', ['-c', 'ls -la'], {
        reject: false,
        cwd: '/test',
      });
      expect(mockLogger.logCommand).toHaveBeenCalledWith('bash', ['-c', 'ls -la'], '/test', 'task-1');
    });
  });
});
