import { Logger, logger } from '../../utils/logger';
import fs from 'fs';
import path from 'path';
import { LOGS_DIR } from '../../utils/constants';

// Mock fs
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock console.log
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();

describe('Logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.appendFileSync.mockReturnValue(undefined);

    // Mock Date.now to return consistent timestamps
    jest
      .spyOn(Date.prototype, 'toISOString')
      .mockReturnValue('2023-01-01T12:00:00.000Z');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = Logger.getInstance();
      const instance2 = Logger.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should create logs directory if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      new Logger();

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(LOGS_DIR, {
        recursive: true,
      });
    });
  });

  describe('log methods', () => {
    let loggerInstance: Logger;

    beforeEach(() => {
      loggerInstance = new Logger();
    });

    it('should log debug message', () => {
      loggerInstance.debug('Debug message');

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [DEBUG] Debug message'
      );
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        path.join(LOGS_DIR, 'duckling-2023-01-01.log'),
        '[2023-01-01T12:00:00.000Z] [DEBUG] Debug message\n'
      );
    });

    it('should log info message', () => {
      loggerInstance.info('Info message');

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [INFO] Info message'
      );
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        path.join(LOGS_DIR, 'duckling-2023-01-01.log'),
        '[2023-01-01T12:00:00.000Z] [INFO] Info message\n'
      );
    });

    it('should log warn message', () => {
      loggerInstance.warn('Warn message');

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [WARN] Warn message'
      );
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        path.join(LOGS_DIR, 'duckling-2023-01-01.log'),
        '[2023-01-01T12:00:00.000Z] [WARN] Warn message\n'
      );
    });

    it('should log error message', () => {
      loggerInstance.error('Error message');

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [ERROR] Error message'
      );
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        path.join(LOGS_DIR, 'duckling-2023-01-01.log'),
        '[2023-01-01T12:00:00.000Z] [ERROR] Error message\n'
      );
    });

    it('should log message with taskId', () => {
      loggerInstance.info('Task message', 'task-123');

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [INFO] [task-123] Task message'
      );
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        path.join(LOGS_DIR, 'duckling-2023-01-01.log'),
        '[2023-01-01T12:00:00.000Z] [INFO] [task-123] Task message\n'
      );
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        path.join(LOGS_DIR, 'task-task-123.log'),
        '[2023-01-01T12:00:00.000Z] [INFO] [task-123] Task message\n'
      );
    });
  });

  describe('command logging', () => {
    let loggerInstance: Logger;

    beforeEach(() => {
      loggerInstance = new Logger();
    });

    it('should log command execution', () => {
      loggerInstance.logCommand('git', ['status'], '/tmp', 'task-123');

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [INFO] [task-123] Executing: git status (cwd: /tmp)'
      );
    });

    it('should log successful command result', () => {
      loggerInstance.logCommandResult(
        'git',
        0,
        'success output',
        '',
        'task-123'
      );

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [INFO] [task-123] Command succeeded: git'
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [DEBUG] [task-123] stdout:\nsuccess output'
      );
    });

    it('should log failed command result', () => {
      loggerInstance.logCommandResult(
        'git',
        1,
        'output',
        'error output',
        'task-123'
      );

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [ERROR] [task-123] Command failed: git (exit code: 1)'
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [ERROR] [task-123] stderr:\nerror output'
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [DEBUG] [task-123] stdout:\noutput'
      );
    });

    it('should log command result without stdout/stderr', () => {
      loggerInstance.logCommandResult('git', 0, '', '', 'task-123');

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [INFO] [task-123] Command succeeded: git'
      );
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
    });
  });

  describe('exported logger instance', () => {
    it('should be an instance of Logger', () => {
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should be the same instance as getInstance', () => {
      expect(logger).toBe(Logger.getInstance());
    });
  });
});
