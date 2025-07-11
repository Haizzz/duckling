import fs from 'fs';
import path from 'path';

jest.mock('fs');
jest.mock('path');
jest.mock('../constants', () => ({
  LOGS_DIR: '/mock/logs',
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;

// Import logger after mocks are set up
import { Logger, logger } from '../logger';

describe('Logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.appendFileSync.mockReturnValue(undefined);
    mockPath.join.mockImplementation((...args) => args.join('/'));
    
    // Mock console.log to avoid test output
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should create logs directory if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      
      new Logger();
      
      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/mock/logs', { recursive: true });
    });

    it('should not create logs directory if it already exists', () => {
      mockFs.existsSync.mockReturnValue(true);
      
      new Logger();
      
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = Logger.getInstance();
      const instance2 = Logger.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });

  describe('Log Methods', () => {
    beforeEach(() => {
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2023-01-01T12:00:00.000Z');
    });

    it('should log debug message', () => {
      logger.debug('Test debug message');
      
      expect(console.log).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [DEBUG] Test debug message'
      );
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        'duckling-2023-01-01.log',
        '[2023-01-01T12:00:00.000Z] [DEBUG] Test debug message\n'
      );
    });

    it('should log info message', () => {
      logger.info('Test info message');
      
      expect(console.log).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [INFO] Test info message'
      );
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        'duckling-2023-01-01.log',
        '[2023-01-01T12:00:00.000Z] [INFO] Test info message\n'
      );
    });

    it('should log warn message', () => {
      logger.warn('Test warn message');
      
      expect(console.log).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [WARN] Test warn message'
      );
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        'duckling-2023-01-01.log',
        '[2023-01-01T12:00:00.000Z] [WARN] Test warn message\n'
      );
    });

    it('should log error message', () => {
      logger.error('Test error message');
      
      expect(console.log).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [ERROR] Test error message'
      );
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        'duckling-2023-01-01.log',
        '[2023-01-01T12:00:00.000Z] [ERROR] Test error message\n'
      );
    });

    it('should log message with taskId', () => {
      logger.info('Test message', 'task-123');
      
      expect(console.log).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [INFO] [task-123] Test message'
      );
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        'duckling-2023-01-01.log',
        '[2023-01-01T12:00:00.000Z] [INFO] [task-123] Test message\n'
      );
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        'task-task-123.log',
        '[2023-01-01T12:00:00.000Z] [INFO] [task-123] Test message\n'
      );
    });
  });

  describe('Command Logging', () => {
    beforeEach(() => {
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2023-01-01T12:00:00.000Z');
    });

    it('should log command execution', () => {
      logger.logCommand('git', ['status'], '/test/path');
      
      expect(console.log).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [INFO] Executing: git status (cwd: /test/path)'
      );
    });

    it('should log command execution with taskId', () => {
      logger.logCommand('git', ['status'], '/test/path', 'task-123');
      
      expect(console.log).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [INFO] [task-123] Executing: git status (cwd: /test/path)'
      );
    });

    it('should log successful command result', () => {
      logger.logCommandResult('git', 0, 'Success output', '');
      
      expect(console.log).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [INFO] Command succeeded: git'
      );
      expect(console.log).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [DEBUG] stdout:\nSuccess output'
      );
    });

    it('should log failed command result', () => {
      logger.logCommandResult('git', 1, 'Error output', 'Error message');
      
      expect(console.log).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [ERROR] Command failed: git (exit code: 1)'
      );
      expect(console.log).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [ERROR] stderr:\nError message'
      );
      expect(console.log).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [DEBUG] stdout:\nError output'
      );
    });

    it('should log command result with taskId', () => {
      logger.logCommandResult('git', 0, 'Success output', '', 'task-123');
      
      expect(console.log).toHaveBeenCalledWith(
        '[2023-01-01T12:00:00.000Z] [INFO] [task-123] Command succeeded: git'
      );
    });
  });
});
