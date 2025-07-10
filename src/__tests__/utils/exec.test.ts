import {
  execCommand,
  execCommandWithInputStreaming,
  execCommandStreaming,
  execShellCommand,
} from '../../utils/exec';
import { execa } from 'execa';
import { logger } from '../../utils/logger';

// Mock execa
jest.mock('execa');
const mockExeca = execa as jest.MockedFunction<typeof execa>;

// Mock logger
jest.mock('../../utils/logger');
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('exec utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('execCommand', () => {
    it('should execute command successfully', async () => {
      const mockResult = {
        stdout: 'success output',
        stderr: '',
        exitCode: 0,
      };
      mockExeca.mockResolvedValue(mockResult as any);

      const result = await execCommand('echo', ['hello']);

      expect(result).toEqual({
        stdout: 'success output',
        stderr: '',
        exitCode: 0,
      });
      expect(mockExeca).toHaveBeenCalledWith('echo', ['hello'], {
        reject: false,
      });
      expect(mockLogger.logCommand).toHaveBeenCalledWith(
        'echo',
        ['hello'],
        process.cwd(),
        undefined
      );
      expect(mockLogger.logCommandResult).toHaveBeenCalledWith(
        'echo',
        0,
        'success output',
        '',
        undefined
      );
    });

    it('should handle command failure', async () => {
      const mockResult = {
        stdout: '',
        stderr: 'error output',
        exitCode: 1,
      };
      mockExeca.mockResolvedValue(mockResult as any);

      const result = await execCommand('false', []);

      expect(result).toEqual({
        stdout: '',
        stderr: 'error output',
        exitCode: 1,
      });
      expect(mockLogger.logCommandResult).toHaveBeenCalledWith(
        'false',
        1,
        '',
        'error output',
        undefined
      );
    });

    it('should handle command with options', async () => {
      const mockResult = {
        stdout: 'output',
        stderr: '',
        exitCode: 0,
      };
      mockExeca.mockResolvedValue(mockResult as any);

      const result = await execCommand('ls', ['-la'], {
        cwd: '/tmp',
        taskId: 'task-123',
      });

      expect(result).toEqual({
        stdout: 'output',
        stderr: '',
        exitCode: 0,
      });
      expect(mockExeca).toHaveBeenCalledWith('ls', ['-la'], {
        reject: false,
        cwd: '/tmp',
      });
      expect(mockLogger.logCommand).toHaveBeenCalledWith(
        'ls',
        ['-la'],
        '/tmp',
        'task-123'
      );
    });

    it('should handle execa throwing an error', async () => {
      const error = new Error('Command failed');
      (error as any).exitCode = 127;
      (error as any).stdout = 'error stdout';
      (error as any).stderr = 'error stderr';
      mockExeca.mockRejectedValue(error);

      await expect(execCommand('nonexistent', [])).rejects.toThrow(
        'Command failed'
      );
      expect(mockLogger.logCommandResult).toHaveBeenCalledWith(
        'nonexistent',
        127,
        'error stdout',
        'error stderr',
        undefined
      );
    });
  });

  describe('execCommandWithInputStreaming', () => {
    it('should execute command with input streaming', async () => {
      const mockSubprocess = {
        stdout: {
          on: jest.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from('stream output'));
            }
          }),
        },
        stderr: {
          on: jest.fn(),
        },
        exitCode: 0,
      };
      mockExeca.mockResolvedValue(mockSubprocess as any);

      const result = await execCommandWithInputStreaming(
        'cat',
        'test input',
        []
      );

      expect(result).toEqual({
        stdout: 'stream output',
        stderr: '',
        exitCode: 0,
      });
      expect(mockExeca).toHaveBeenCalledWith('cat', [], {
        reject: false,
        input: 'test input',
        stdio: 'pipe',
      });
    });

    it('should handle stderr streaming', async () => {
      const mockSubprocess = {
        stdout: {
          on: jest.fn(),
        },
        stderr: {
          on: jest.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from('error stream'));
            }
          }),
        },
        exitCode: 1,
      };
      mockExeca.mockResolvedValue(mockSubprocess as any);

      const result = await execCommandWithInputStreaming(
        'cat',
        'test input',
        [],
        { taskId: 'task-123' }
      );

      expect(result).toEqual({
        stdout: '',
        stderr: 'error stream',
        exitCode: 1,
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'stderr:\nerror stream',
        'task-123'
      );
    });
  });

  describe('execCommandStreaming', () => {
    it('should execute command with streaming', async () => {
      const mockSubprocess = {
        stdout: {
          on: jest.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from('stream output'));
            }
          }),
        },
        stderr: {
          on: jest.fn(),
        },
        exitCode: 0,
      };
      mockExeca.mockResolvedValue(mockSubprocess as any);

      const result = await execCommandStreaming('echo', ['hello']);

      expect(result).toEqual({
        stdout: 'stream output',
        stderr: '',
        exitCode: 0,
      });
      expect(mockExeca).toHaveBeenCalledWith('echo', ['hello'], {
        reject: false,
        stdio: 'pipe',
      });
    });
  });

  describe('execShellCommand', () => {
    it('should execute shell command', async () => {
      const mockResult = {
        stdout: 'shell output',
        stderr: '',
        exitCode: 0,
      };
      mockExeca.mockResolvedValue(mockResult as any);

      const result = await execShellCommand('echo "hello world"');

      expect(result).toEqual({
        stdout: 'shell output',
        stderr: '',
        exitCode: 0,
      });
      expect(mockExeca).toHaveBeenCalledWith(
        'bash',
        ['-c', 'echo "hello world"'],
        {
          reject: false,
        }
      );
    });

    it('should execute shell command with options', async () => {
      const mockResult = {
        stdout: 'shell output',
        stderr: '',
        exitCode: 0,
      };
      mockExeca.mockResolvedValue(mockResult as any);

      const result = await execShellCommand('pwd', {
        cwd: '/tmp',
        taskId: 'task-456',
      });

      expect(result).toEqual({
        stdout: 'shell output',
        stderr: '',
        exitCode: 0,
      });
      expect(mockExeca).toHaveBeenCalledWith('bash', ['-c', 'pwd'], {
        reject: false,
        cwd: '/tmp',
      });
      expect(mockLogger.logCommand).toHaveBeenCalledWith(
        'bash',
        ['-c', 'pwd'],
        '/tmp',
        'task-456'
      );
    });
  });
});
