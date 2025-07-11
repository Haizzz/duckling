import Database from 'better-sqlite3';
import fs from 'fs';
import { DatabaseManager } from '../database';
import { DUCKLING_DIR, DATABASE_PATH } from '../../utils/constants';

jest.mock('better-sqlite3');
jest.mock('fs');
jest.mock('../migrations');

const mockDatabase = {
  pragma: jest.fn(),
  exec: jest.fn(),
  prepare: jest.fn(),
  close: jest.fn(),
};

const mockFs = fs as jest.Mocked<typeof fs>;
const mockDatabaseConstructor = Database as jest.MockedClass<typeof Database>;

describe('DatabaseManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockDatabaseConstructor.mockReturnValue(mockDatabase as any);
    
    mockDatabase.prepare.mockReturnValue({
      run: jest.fn(),
      get: jest.fn(),
      all: jest.fn(),
    } as any);
  });

  describe('Constructor', () => {
    it('should create DUCKLING_DIR if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      
      new DatabaseManager();
      
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(DUCKLING_DIR, { recursive: true });
    });

    it('should initialize database with correct path', () => {
      new DatabaseManager();
      
      expect(mockDatabaseConstructor).toHaveBeenCalledWith(DATABASE_PATH);
    });

    it('should enable WAL mode', () => {
      new DatabaseManager();
      
      expect(mockDatabase.pragma).toHaveBeenCalledWith('journal_mode = WAL');
    });

    it('should initialize tables', () => {
      new DatabaseManager();
      
      expect(mockDatabase.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS repositories')
      );
      expect(mockDatabase.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS tasks')
      );
      expect(mockDatabase.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS task_logs')
      );
      expect(mockDatabase.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS settings')
      );
      expect(mockDatabase.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS precommit_checks')
      );
    });
  });

  describe('Task Management', () => {
    let dbManager: DatabaseManager;

    beforeEach(() => {
      dbManager = new DatabaseManager();
    });

    describe('createTask', () => {
      it('should create a new task', () => {
        const mockRun = jest.fn().mockReturnValue({ lastInsertRowid: 1 });
        mockDatabase.prepare.mockReturnValue({ run: mockRun } as any);

        const result = dbManager.createTask({
          title: 'Test Task',
          description: 'Test Description',
          coding_tool: 'openai',
          repository_path: '/test/path',
          status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any);

        expect(result).toBe(1);
        expect(mockDatabase.prepare).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO tasks')
        );
        expect(mockRun).toHaveBeenCalledWith(
          'Test Task',
          'Test Description',
          null,
          'pending',
          'openai',
          '/test/path',
          null,
          null,
          null,
          null,
          null
        );
      });
    });

    describe('getTask', () => {
      it('should get a task by id', () => {
        const mockTask = { id: 1, title: 'Test Task' };
        const mockGet = jest.fn().mockReturnValue(mockTask);
        mockDatabase.prepare.mockReturnValue({ get: mockGet } as any);

        const result = dbManager.getTask(1);

        expect(result).toBe(mockTask);
        expect(mockDatabase.prepare).toHaveBeenCalledWith(
          expect.stringContaining('SELECT * FROM tasks WHERE id = ?')
        );
        expect(mockGet).toHaveBeenCalledWith(1);
      });

      it('should return null for non-existent task', () => {
        const mockGet = jest.fn().mockReturnValue(null);
        mockDatabase.prepare.mockReturnValue({ get: mockGet } as any);

        const result = dbManager.getTask(999);

        expect(result).toBeNull();
        expect(mockGet).toHaveBeenCalledWith(999);
      });
    });

    describe('getTasks', () => {
      it('should get all tasks', () => {
        const mockTasks = [
          { id: 1, title: 'Task 1' },
          { id: 2, title: 'Task 2' }
        ];
        const mockAll = jest.fn().mockReturnValue(mockTasks);
        mockDatabase.prepare.mockReturnValue({ all: mockAll } as any);

        const result = dbManager.getTasks();

        expect(result).toBe(mockTasks);
        expect(mockDatabase.prepare).toHaveBeenCalledWith(
          expect.stringContaining('SELECT * FROM tasks ORDER BY created_at DESC')
        );
        expect(mockAll).toHaveBeenCalled();
      });
    });

    describe('updateTask', () => {
      it('should update task status', () => {
        const mockRun = jest.fn();
        mockDatabase.prepare.mockReturnValue({ run: mockRun } as any);

        dbManager.updateTask(1, { status: 'completed' });

        expect(mockDatabase.prepare).toHaveBeenLastCalledWith(
          expect.stringContaining('UPDATE tasks')
        );
        expect(mockRun).toHaveBeenCalledWith(
          'completed',
          1
        );
      });

      it('should update multiple fields', () => {
        const mockRun = jest.fn();
        mockDatabase.prepare.mockReturnValue({ run: mockRun } as any);

        dbManager.updateTask(1, {
          status: 'completed',
          summary: 'Test Summary',
          branch_name: 'test-branch'
        });

        expect(mockDatabase.prepare).toHaveBeenLastCalledWith(
          expect.stringContaining('UPDATE tasks')
        );
        expect(mockRun).toHaveBeenCalledWith(
          'completed',
          'Test Summary',
          'test-branch',
          1
        );
      });
    });

    describe('deleteTask', () => {
      it('should delete a task', () => {
        const mockRun = jest.fn();
        mockDatabase.prepare.mockReturnValue({ run: mockRun } as any);

        dbManager.deleteTask(1);

        expect(mockDatabase.prepare).toHaveBeenCalledWith(
          expect.stringContaining('DELETE FROM tasks WHERE id = ?')
        );
        expect(mockRun).toHaveBeenCalledWith(1);
      });
    });
  });

  describe('Task Logs', () => {
    let dbManager: DatabaseManager;

    beforeEach(() => {
      dbManager = new DatabaseManager();
    });

    describe('addTaskLog', () => {
      it('should add a task log', () => {
        const mockRun = jest.fn();
        mockDatabase.prepare.mockReturnValue({ run: mockRun } as any);

        dbManager.addTaskLog({
          task_id: 1,
          level: 'info',
          message: 'Test message'
        });

        expect(mockDatabase.prepare).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO task_logs')
        );
        expect(mockRun).toHaveBeenCalledWith(1, 'info', 'Test message');
      });
    });

    describe('getTaskLogs', () => {
      it('should get task logs', () => {
        const mockLogs = [
          { id: 1, message: 'Log 1' },
          { id: 2, message: 'Log 2' }
        ];
        const mockAll = jest.fn().mockReturnValue(mockLogs);
        mockDatabase.prepare.mockReturnValue({ all: mockAll } as any);

        const result = dbManager.getTaskLogs(1);

        expect(result).toBe(mockLogs);
        expect(mockDatabase.prepare).toHaveBeenCalledWith(
          expect.stringContaining('SELECT * FROM task_logs WHERE task_id = ?')
        );
        expect(mockAll).toHaveBeenCalledWith(1);
      });
    });
  });

  describe('Settings Management', () => {
    let dbManager: DatabaseManager;

    beforeEach(() => {
      dbManager = new DatabaseManager();
    });

    describe('setSetting', () => {
      it('should set a setting', () => {
        const mockRun = jest.fn();
        mockDatabase.prepare.mockReturnValue({ run: mockRun } as any);

        dbManager.setSetting('test_key', 'test_value');

        expect(mockDatabase.prepare).toHaveBeenCalledWith(
          expect.stringContaining('INSERT OR REPLACE INTO settings')
        );
        expect(mockRun).toHaveBeenCalledWith('test_key', 'test_value');
      });
    });

    describe('getSetting', () => {
      it('should get a setting', () => {
        const mockSetting = { key: 'test_key', value: 'test_value' };
        const mockGet = jest.fn().mockReturnValue(mockSetting);
        mockDatabase.prepare.mockReturnValue({ get: mockGet } as any);

        const result = dbManager.getSetting('test_key');

        expect(result).toBe(mockSetting);
        expect(mockDatabase.prepare).toHaveBeenCalledWith(
          expect.stringContaining('SELECT * FROM settings WHERE key = ?')
        );
        expect(mockGet).toHaveBeenCalledWith('test_key');
      });
    });

    describe('getAllSettings', () => {
      it('should get all settings', () => {
        const mockSettings = [
          { key: 'key1', value: 'value1' },
          { key: 'key2', value: 'value2' }
        ];
        const mockAll = jest.fn().mockReturnValue(mockSettings);
        mockDatabase.prepare.mockReturnValue({ all: mockAll } as any);

        const result = dbManager.getSettings();

        expect(result).toBe(mockSettings);
        expect(mockDatabase.prepare).toHaveBeenCalledWith(
          expect.stringContaining('SELECT * FROM settings')
        );
        expect(mockAll).toHaveBeenCalled();
      });
    });
  });

  describe('Repository Management', () => {
    let dbManager: DatabaseManager;

    beforeEach(() => {
      dbManager = new DatabaseManager();
    });

    describe('getRepository', () => {
      it('should get existing repository', () => {
        const mockRepo = { id: 1, path: '/test/path', name: 'test', owner: 'owner' };
        const mockGet = jest.fn().mockReturnValue(mockRepo);
        mockDatabase.prepare.mockReturnValue({ get: mockGet } as any);

        const result = dbManager.getRepository('/test/path');

        expect(result).toBe(mockRepo);
        expect(mockDatabase.prepare).toHaveBeenCalledWith(
          expect.stringContaining('SELECT * FROM repositories WHERE path = ?')
        );
        expect(mockGet).toHaveBeenCalledWith('/test/path');
      });

      it('should return null for non-existent repository', () => {
        const mockGet = jest.fn().mockReturnValue(null);
        mockDatabase.prepare.mockReturnValue({ get: mockGet } as any);

        const result = dbManager.getRepository('/non/existent/path');

        expect(result).toBeNull();
        expect(mockGet).toHaveBeenCalledWith('/non/existent/path');
      });
    });

    describe('addRepository', () => {
      it('should add a new repository', () => {
        const mockRun = jest.fn().mockReturnValue({ lastInsertRowid: 1 });
        mockDatabase.prepare.mockReturnValue({ run: mockRun } as any);

        const result = dbManager.addRepository({
          path: '/test/path',
          name: 'test',
          owner: 'owner'
        });

        expect(result).toBe(1);
        expect(mockDatabase.prepare).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO repositories')
        );
        expect(mockRun).toHaveBeenCalledWith('/test/path', 'test', 'owner');
      });
    });

    describe('getRepositories', () => {
      it('should get all repositories', () => {
        const mockRepos = [
          { id: 1, path: '/test/path1', name: 'test1', owner: 'owner1' },
          { id: 2, path: '/test/path2', name: 'test2', owner: 'owner2' }
        ];
        const mockAll = jest.fn().mockReturnValue(mockRepos);
        mockDatabase.prepare.mockReturnValue({ all: mockAll } as any);

        const result = dbManager.getRepositories();

        expect(result).toBe(mockRepos);
        expect(mockDatabase.prepare).toHaveBeenLastCalledWith(
          expect.stringContaining('SELECT * FROM repositories ORDER BY created_at ASC')
        );
        expect(mockAll).toHaveBeenCalled();
      });
    });
  });

  describe('Database Connection', () => {
    let dbManager: DatabaseManager;

    beforeEach(() => {
      dbManager = new DatabaseManager();
    });

    describe('close', () => {
      it('should close database connection', () => {
        dbManager.close();
        
        expect(mockDatabase.close).toHaveBeenCalled();
      });
    });
  });
});
