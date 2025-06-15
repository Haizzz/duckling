import { execCommand, execCommandWithInput, execShellCommand } from '../exec';
import { logger } from '../logger';

// Mock execa at the module level to avoid ES module import issues
jest.mock('execa', () => ({
  execa: jest.fn(),
  execaSync: jest.fn(),
}));

const execaModule = {
  execa: jest.fn(),
  execaSync: jest.fn(),
};

describe('exec utils', () => {
  describe('execCommand', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('executes command with arguments and returns stdout result', async () => {
      const mockResult = {
        stdout: 'output',
        stderr: '',
        exitCode: 0,
      };
      execaModule.execa.mockResolvedValue(mockResult as any);

      const logCommandSpy = jest
        .spyOn(logger, 'logCommand')
        .mockImplementation();
      const logResultSpy = jest
        .spyOn(logger, 'logCommandResult')
        .mockImplementation();

      const result = await execCommand('echo', ['hello']);

      expect(result).toEqual({ stdout: 'output', stderr: '', exitCode: 0 });
      expect(logCommandSpy).toHaveBeenCalledWith(
        'echo',
        ['hello'],
        process.cwd(),
        undefined
      );
      expect(logResultSpy).toHaveBeenCalledWith(
        'echo',
        0,
        'output',
        '',
        undefined
      );
    });

    it('uses custom working directory when provided in options', async () => {
      const mockResult = { stdout: '', stderr: '', exitCode: 0 };
      execaModule.execa.mockResolvedValue(mockResult as any);

      const logCommandSpy = jest
        .spyOn(logger, 'logCommand')
        .mockImplementation();
      jest.spyOn(logger, 'logCommandResult').mockImplementation();

      await execCommand('ls', [], { cwd: '/tmp' });

      expect(logCommandSpy).toHaveBeenCalledWith('ls', [], '/tmp', undefined);
    });

    it('includes taskId in logging when provided in options', async () => {
      const mockResult = { stdout: '', stderr: '', exitCode: 0 };
      execaModule.execa.mockResolvedValue(mockResult as any);

      const logCommandSpy = jest
        .spyOn(logger, 'logCommand')
        .mockImplementation();
      const logResultSpy = jest
        .spyOn(logger, 'logCommandResult')
        .mockImplementation();

      await execCommand('test', [], { taskId: 'task123' });

      expect(logCommandSpy).toHaveBeenCalledWith(
        'test',
        [],
        process.cwd(),
        'task123'
      );
      expect(logResultSpy).toHaveBeenCalledWith('test', 0, '', '', 'task123');
    });

    it('handles command failure with non-zero exit code', async () => {
      const mockResult = { stdout: '', stderr: 'error', exitCode: 1 };
      execaModule.execa.mockResolvedValue(mockResult as any);

      jest.spyOn(logger, 'logCommand').mockImplementation();
      const logResultSpy = jest
        .spyOn(logger, 'logCommandResult')
        .mockImplementation();

      const result = await execCommand('false');

      expect(result.exitCode).toBe(1);
      expect(logResultSpy).toHaveBeenCalledWith(
        'false',
        1,
        '',
        'error',
        undefined
      );
    });

    it('handles execa errors and throws with exit code and output', async () => {
      const error = Object.assign(new Error('Command failed'), {
        exitCode: 127,
        stdout: 'error output',
        stderr: 'error message',
      });

      execaModule.execa.mockRejectedValue(error as any);

      jest.spyOn(logger, 'logCommand').mockImplementation();
      const logResultSpy = jest
        .spyOn(logger, 'logCommandResult')
        .mockImplementation();

      await expect(execCommand('nonexistent')).rejects.toThrow(
        'Command failed'
      );

      expect(logResultSpy).toHaveBeenCalledWith(
        'nonexistent',
        127,
        'error output',
        'error message',
        undefined
      );
    });
  });

  describe('execCommandWithInput', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('passes input to command via stdin', async () => {
      const mockResult = { stdout: 'result', stderr: '', exitCode: 0 };
      execaModule.execa.mockResolvedValue(mockResult as any);

      jest.spyOn(logger, 'logCommand').mockImplementation();
      jest.spyOn(logger, 'logCommandResult').mockImplementation();

      await execCommandWithInput('cat', 'test input');

      expect(execaModule.execa).toHaveBeenCalledWith('cat', [], {
        reject: false,
        input: 'test input',
      });
    });
  });

  describe('execShellCommand', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('executes command through bash shell with -c flag', async () => {
      const mockResult = { stdout: 'output', stderr: '', exitCode: 0 };
      execaModule.execa.mockResolvedValue(mockResult as any);

      jest.spyOn(logger, 'logCommand').mockImplementation();
      jest.spyOn(logger, 'logCommandResult').mockImplementation();

      await execShellCommand('echo hello');

      expect(execaModule.execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'echo hello'],
        {
          reject: false,
        }
      );
    });
  });
});
