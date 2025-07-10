import { DatabaseManager } from '../../core/database';
import {
  Task,
  TaskLog,
  Setting,
  PrecommitCheck,
  Repository,
} from '../../types';
import Database from 'better-sqlite3';
import fs from 'fs';
import { DUCKLING_DIR, DATABASE_PATH } from '../../utils/constants';

// Mock better-sqlite3
jest.mock('better-sqlite3');
const mockDatabase = Database as jest.MockedClass<typeof Database>;

// Mock fs
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock migrations
jest.mock('../../core/migrations', () => ({
  runMultiRepositoryMigration: jest.fn(),
}));

describe('DatabaseManager', () => {
  let mockDb: any;
  let mockStmt: any;
  let databaseManager: DatabaseManager;

  beforeEach(() => {
    jest.clearAllMocks();

    mockStmt = {
      run: jest.fn(),
      get: jest.fn(),
      all: jest.fn(),
      prepare: jest.fn(),
    };

    mockDb = {
      exec: jest.fn(),
      prepare: jest.fn(() => mockStmt),
      pragma: jest.fn(),
      close: jest.fn(),
    };

    mockDatabase.mockImplementation(() => mockDb);
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReturnValue(undefined);

    databaseManager = new DatabaseManager();
  });

  describe('constructor', () => {
    it('should create duckling directory if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      new DatabaseManager();

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(DUCKLING_DIR, {
        recursive: true,
      });
    });

    it('should initialize database with WAL mode', () => {
      expect(mockDatabase).toHaveBeenCalledWith(DATABASE_PATH);
      expect(mockDb.pragma).toHaveBeenCalledWith('journal_mode = WAL');
    });

    it('should initialize tables on construction', () => {
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS repositories')
      );
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS tasks')
      );
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS task_logs')
      );
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS settings')
      );
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS precommit_checks')
      );
    });
  });

  describe('createTask', () => {
    it('should create a new task and return its id', () => {
      const mockTask: Omit<Task, 'id' | 'created_at' | 'updated_at'> = {
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending',
        coding_tool: 'amp',
        repository_path: '/test/path',
      };

      mockStmt.run.mockReturnValue({ lastInsertRowid: 123 });

      const result = databaseManager.createTask(mockTask);

      expect(result).toBe(123);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tasks')
      );
      expect(mockStmt.run).toHaveBeenCalledWith(
        'Test Task',
        'Test Description',
        null,
        'pending',
        'amp',
        '/test/path',
        null,
        null,
        null,
        null,
        null
      );
    });

    it('should handle task with all optional fields', () => {
      const mockTask: Omit<Task, 'id' | 'created_at' | 'updated_at'> = {
        title: 'Test Task',
        description: 'Test Description',
        summary: 'Test Summary',
        status: 'completed',
        coding_tool: 'openai',
        repository_path: '/test/path',
        current_stage: 'final',
        branch_name: 'test-branch',
        pr_number: 456,
        pr_url: 'https://github.com/test/pr/456',
        completed_at: '2023-01-01T12:00:00Z',
      };

      mockStmt.run.mockReturnValue({ lastInsertRowid: 456 });

      const result = databaseManager.createTask(mockTask);

      expect(result).toBe(456);
      expect(mockStmt.run).toHaveBeenCalledWith(
        'Test Task',
        'Test Description',
        'Test Summary',
        'completed',
        'openai',
        '/test/path',
        'final',
        'test-branch',
        456,
        'https://github.com/test/pr/456',
        '2023-01-01T12:00:00Z'
      );
    });
  });

  describe('updateTask', () => {
    it('should update a task with provided fields', () => {
      const updates = {
        status: 'completed' as const,
        pr_number: 789,
        completed_at: '2023-01-01T12:00:00Z',
      };

      databaseManager.updateTask(123, updates);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tasks SET')
      );
      expect(mockStmt.run).toHaveBeenCalledWith(
        'completed',
        789,
        '2023-01-01T12:00:00Z',
        expect.any(String), // updated_at timestamp
        123
      );
    });

    it('should handle partial updates', () => {
      const updates = {
        status: 'in-progress' as const,
      };

      databaseManager.updateTask(456, updates);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tasks SET')
      );
      expect(mockStmt.run).toHaveBeenCalledWith(
        'in-progress',
        expect.any(String), // updated_at timestamp
        456
      );
    });
  });

  describe('getTask', () => {
    it('should retrieve a task by id', () => {
      const mockTask = {
        id: 123,
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending',
        coding_tool: 'amp',
        repository_path: '/test/path',
        created_at: '2023-01-01T12:00:00Z',
        updated_at: '2023-01-01T12:00:00Z',
      };

      mockStmt.get.mockReturnValue(mockTask);

      const result = databaseManager.getTask(123);

      expect(result).toEqual(mockTask);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM tasks WHERE id = ?')
      );
      expect(mockStmt.get).toHaveBeenCalledWith(123);
    });

    it('should return undefined for non-existent task', () => {
      mockStmt.get.mockReturnValue(undefined);

      const result = databaseManager.getTask(999);

      expect(result).toBeUndefined();
    });
  });

  describe('getTasks', () => {
    it('should retrieve all tasks', () => {
      const mockTasks = [
        { id: 1, title: 'Task 1', status: 'pending' },
        { id: 2, title: 'Task 2', status: 'completed' },
      ];

      mockStmt.all.mockReturnValue(mockTasks);

      const result = databaseManager.getTasks();

      expect(result).toEqual(mockTasks);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM tasks')
      );
    });

    it('should retrieve tasks by status', () => {
      const mockTasks = [
        { id: 1, title: 'Task 1', status: 'pending' },
        { id: 2, title: 'Task 2', status: 'pending' },
      ];

      mockStmt.all.mockReturnValue(mockTasks);

      const result = databaseManager.getTasks({ status: 'pending' });

      expect(result).toEqual(mockTasks);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM tasks')
      );
      expect(mockStmt.all).toHaveBeenCalledWith('pending');
    });
  });

  describe('addTaskLog', () => {
    it('should add a task log entry', () => {
      const logEntry = {
        task_id: 123,
        level: 'info' as const,
        message: 'Test log message',
      };

      databaseManager.addTaskLog(logEntry);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO task_logs')
      );
      expect(mockStmt.run).toHaveBeenCalledWith(
        123,
        'info',
        'Test log message'
      );
    });
  });

  describe('getTaskLogs', () => {
    it('should retrieve task logs by task id', () => {
      const mockLogs = [
        { id: 1, task_id: 123, level: 'info', message: 'Log 1' },
        { id: 2, task_id: 123, level: 'error', message: 'Log 2' },
      ];

      mockStmt.all.mockReturnValue(mockLogs);

      const result = databaseManager.getTaskLogs(123);

      expect(result).toEqual(mockLogs);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM task_logs WHERE task_id = ?')
      );
      expect(mockStmt.all).toHaveBeenCalledWith(123);
    });
  });

  describe('setting operations', () => {
    it('should set a setting', () => {
      databaseManager.setSetting('testKey', 'testValue');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO settings')
      );
      expect(mockStmt.run).toHaveBeenCalledWith('testKey', 'testValue');
    });

    it('should get a setting', () => {
      const mockSetting = { key: 'testKey', value: 'testValue' };
      mockStmt.get.mockReturnValue(mockSetting);

      const result = databaseManager.getSetting('testKey');

      expect(result).toBe('testValue');
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT value FROM settings WHERE key = ?')
      );
      expect(mockStmt.get).toHaveBeenCalledWith('testKey');
    });

    it('should return undefined for non-existent setting', () => {
      mockStmt.get.mockReturnValue(undefined);

      const result = databaseManager.getSetting('nonExistentKey');

      expect(result).toBeUndefined();
    });

    it('should get all settings', () => {
      const mockSettings = [
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
      ];
      mockStmt.all.mockReturnValue(mockSettings);

      const result = databaseManager.getSettings();

      expect(result).toEqual(mockSettings);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM settings')
      );
    });
  });

  describe('precommit check operations', () => {
    it('should add a precommit check', () => {
      const check = {
        name: 'lint',
        command: 'npm run lint',
        order_index: 1,
      };

      mockStmt.run.mockReturnValue({ lastInsertRowid: 789 });

      const result = databaseManager.addPrecommitCheck(check);

      expect(result).toBe(789);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO precommit_checks')
      );
      expect(mockStmt.run).toHaveBeenCalledWith('lint', 'npm run lint', 1);
    });

    it('should get all precommit checks', () => {
      const mockChecks = [
        { id: 1, name: 'lint', command: 'npm run lint', order_index: 1 },
        { id: 2, name: 'test', command: 'npm test', order_index: 2 },
      ];
      mockStmt.all.mockReturnValue(mockChecks);

      const result = databaseManager.getAllPrecommitChecks();

      expect(result).toEqual(mockChecks);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining(
          'SELECT * FROM precommit_checks ORDER BY order_index'
        )
      );
    });
  });

  describe('repository operations', () => {
    it('should add a repository', () => {
      const repo = {
        path: '/test/path',
        name: 'test-repo',
        owner: 'test-owner',
      };

      mockStmt.run.mockReturnValue({ lastInsertRowid: 101 });

      const result = databaseManager.addRepository(repo);

      expect(result).toBe(101);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO repositories')
      );
      expect(mockStmt.run).toHaveBeenCalledWith(
        '/test/path',
        'test-repo',
        'test-owner'
      );
    });

    it('should get a repository by path', () => {
      const mockRepo = {
        id: 101,
        path: '/test/path',
        name: 'test-repo',
        owner: 'test-owner',
      };
      mockStmt.get.mockReturnValue(mockRepo);

      const result = databaseManager.getRepository('/test/path');

      expect(result).toEqual(mockRepo);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM repositories WHERE path = ?')
      );
      expect(mockStmt.get).toHaveBeenCalledWith('/test/path');
    });

    it('should get all repositories', () => {
      const mockRepos = [
        { id: 1, path: '/path1', name: 'repo1', owner: 'owner1' },
        { id: 2, path: '/path2', name: 'repo2', owner: 'owner2' },
      ];
      mockStmt.all.mockReturnValue(mockRepos);

      const result = databaseManager.getRepositories();

      expect(result).toEqual(mockRepos);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM repositories')
      );
    });
  });

  describe('close', () => {
    it('should close the database connection', () => {
      databaseManager.close();

      expect(mockDb.close).toHaveBeenCalled();
    });
  });
});
