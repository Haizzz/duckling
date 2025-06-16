// Mock dependencies first, before any imports
const mockStmt = {
  run: jest.fn().mockReturnValue({ lastInsertRowid: 1 }),
  get: jest.fn(),
  all: jest.fn(),
};

const mockDb = {
  exec: jest.fn(),
  prepare: jest.fn().mockReturnValue(mockStmt),
  pragma: jest.fn(),
  close: jest.fn(),
};

jest.mock('better-sqlite3', () => {
  return jest.fn().mockImplementation(() => mockDb);
});

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
}));

jest.mock('../../utils/constants', () => ({
  DUCKLING_DIR: '/mock/.duckling',
  DATABASE_PATH: '/mock/.duckling/duckling.db',
  DEFAULT_SETTINGS: {
    branchPrefix: 'duckling-',
    prTitlePrefix: '[DUCKLING]',
    commitSuffix: ' [quack]',
    maxRetries: 3,
    baseBranch: 'main',
  },
}));

import Database from 'better-sqlite3';
import fs from 'fs';
import { DatabaseManager } from '../database';
import { Task, TaskLog, Setting, PrecommitCheck } from '../../types';

const mockFs = fs as jest.Mocked<typeof fs>;

describe('DatabaseManager', () => {
  let databaseManager: DatabaseManager;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mock implementations
    mockStmt.run.mockReturnValue({ lastInsertRowid: 1 });
    mockStmt.get.mockReturnValue(null);
    mockStmt.all.mockReturnValue([]);

    mockFs.existsSync.mockReturnValue(true);

    databaseManager = new DatabaseManager();
  });

  describe('constructor', () => {
    it('creates duckling directory if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      new DatabaseManager();

      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/mock/.duckling', {
        recursive: true,
      });
    });

    it('enables WAL mode for better concurrency', () => {
      expect(mockDb.pragma).toHaveBeenCalledWith('journal_mode = WAL');
    });

    it('initializes database tables and default settings', () => {
      expect(mockDb.exec).toHaveBeenCalled();
      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe('createTask', () => {
    it('creates task with all required fields', () => {
      const mockTask: Omit<Task, 'id' | 'created_at' | 'updated_at'> = {
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending',
        coding_tool: 'amp',
        repository_path: '/test/repo',
        summary: 'Test Summary',
        current_stage: 'planning',
        branch_name: 'test-branch',
        pr_number: 123,
        pr_url: 'https://github.com/test/repo/pull/123',
        completed_at: '2023-01-01T00:00:00Z',
      };

      mockStmt.run.mockReturnValue({ lastInsertRowid: 1 });

      const result = databaseManager.createTask(mockTask);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tasks')
      );
      expect(mockStmt.run).toHaveBeenCalledWith(
        'Test Task',
        'Test Description',
        'Test Summary',
        'pending',
        'amp',
        'planning',
        'test-branch',
        123,
        'https://github.com/test/repo/pull/123',
        '2023-01-01T00:00:00Z'
      );
      expect(result).toBe(1);
    });

    it('creates task with null values for optional fields', () => {
      const mockTask: Omit<Task, 'id' | 'created_at' | 'updated_at'> = {
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending',
        coding_tool: 'amp',
        repository_path: '/test/repo',
      };

      mockStmt.run.mockReturnValue({ lastInsertRowid: 2 });

      const result = databaseManager.createTask(mockTask);

      expect(mockStmt.run).toHaveBeenCalledWith(
        'Test Task',
        'Test Description',
        null,
        'pending',
        'amp',
        null,
        null,
        null,
        null,
        null
      );
      expect(result).toBe(2);
    });
  });

  describe('updateTask', () => {
    it('updates task with provided fields', () => {
      const updates = {
        status: 'in-progress' as const,
        branch_name: 'updated-branch',
        pr_number: 456,
      };

      databaseManager.updateTask(1, updates);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tasks')
      );
      expect(mockStmt.run).toHaveBeenCalledWith(
        'in-progress',
        'updated-branch',
        456,
        1
      );
    });

    it('does not update when no fields provided', () => {
      // Clear mocks to ignore initialization calls
      jest.clearAllMocks();

      databaseManager.updateTask(1, {});

      expect(mockDb.prepare).not.toHaveBeenCalled();
      expect(mockStmt.run).not.toHaveBeenCalled();
    });

    it('excludes id field from updates', () => {
      const updates = {
        id: 999,
        status: 'completed' as const,
      };

      databaseManager.updateTask(1, updates);

      expect(mockStmt.run).toHaveBeenCalledWith('completed', 1);
    });
  });

  describe('getTask', () => {
    it('returns task when found', () => {
      const mockTask: Task = {
        id: 1,
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending',
        coding_tool: 'amp',
        repository_path: '/test/repo',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
      };

      mockStmt.get.mockReturnValue(mockTask);

      const result = databaseManager.getTask(1);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'SELECT * FROM tasks WHERE id = ?'
      );
      expect(mockStmt.get).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockTask);
    });

    it('returns null when task not found', () => {
      mockStmt.get.mockReturnValue(null);

      const result = databaseManager.getTask(999);

      expect(result).toBeNull();
    });
  });

  describe('getTasks', () => {
    const mockTasks: Task[] = [
      {
        id: 1,
        title: 'Task 1',
        description: 'Description 1',
        status: 'pending',
        coding_tool: 'amp',
        repository_path: '/test/repo',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
      },
      {
        id: 2,
        title: 'Task 2',
        description: 'Description 2',
        status: 'completed',
        coding_tool: 'openai',
        repository_path: '/test/repo',
        created_at: '2023-01-02T00:00:00Z',
        updated_at: '2023-01-02T00:00:00Z',
      },
    ];

    it('returns all tasks when no filters provided', () => {
      mockStmt.all.mockReturnValue(mockTasks);

      const result = databaseManager.getTasks();

      expect(mockDb.prepare).toHaveBeenCalledWith('SELECT * FROM tasks');
      expect(mockStmt.all).toHaveBeenCalledWith();
      expect(result).toEqual(mockTasks);
    });

    it('filters tasks by status', () => {
      mockStmt.all.mockReturnValue([mockTasks[0]]);

      const result = databaseManager.getTasks({ status: 'pending' });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'SELECT * FROM tasks WHERE status = ?'
      );
      expect(mockStmt.all).toHaveBeenCalledWith('pending');
      expect(result).toEqual([mockTasks[0]]);
    });

    it('applies limit and offset', () => {
      mockStmt.all.mockReturnValue([mockTasks[1]]);

      const result = databaseManager.getTasks({ limit: 1, offset: 1 });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'SELECT * FROM tasks LIMIT ? OFFSET ?'
      );
      expect(mockStmt.all).toHaveBeenCalledWith(1, 1);
      expect(result).toEqual([mockTasks[1]]);
    });

    it('ignores all status filter', () => {
      mockStmt.all.mockReturnValue(mockTasks);

      const result = databaseManager.getTasks({ status: 'all' });

      expect(mockDb.prepare).toHaveBeenCalledWith('SELECT * FROM tasks');
      expect(result).toEqual(mockTasks);
    });
  });

  describe('deleteTask', () => {
    it('deletes task logs and task', () => {
      // Clear mocks to ignore initialization calls
      jest.clearAllMocks();

      databaseManager.deleteTask(1);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'DELETE FROM task_logs WHERE task_id = ?'
      );
      expect(mockDb.prepare).toHaveBeenCalledWith(
        'DELETE FROM tasks WHERE id = ?'
      );
      expect(mockStmt.run).toHaveBeenCalledWith(1);
      expect(mockStmt.run).toHaveBeenCalledTimes(2);
    });
  });

  describe('addTaskLog', () => {
    it('adds task log with all fields', () => {
      const mockLog: Omit<TaskLog, 'id' | 'timestamp'> = {
        task_id: 1,
        level: 'info',
        message: 'Test log message',
      };

      databaseManager.addTaskLog(mockLog);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO task_logs')
      );
      expect(mockStmt.run).toHaveBeenCalledWith(1, 'info', 'Test log message');
    });
  });

  describe('getTaskLogs', () => {
    const mockLogs: TaskLog[] = [
      {
        id: 1,
        task_id: 1,
        level: 'info',
        message: 'Log 1',
        timestamp: '2023-01-01T00:00:00Z',
      },
      {
        id: 2,
        task_id: 1,
        level: 'error',
        message: 'Log 2',
        timestamp: '2023-01-01T01:00:00Z',
      },
    ];

    it('returns all logs for task', () => {
      mockStmt.all.mockReturnValue(mockLogs);

      const result = databaseManager.getTaskLogs(1);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'SELECT * FROM task_logs WHERE task_id = ? ORDER BY timestamp ASC'
      );
      expect(mockStmt.all).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockLogs);
    });

    it('filters logs by level', () => {
      mockStmt.all.mockReturnValue([mockLogs[1]]);

      databaseManager.getTaskLogs(1, { level: 'error' });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'SELECT * FROM task_logs WHERE task_id = ? AND level = ? ORDER BY timestamp ASC'
      );
      expect(mockStmt.all).toHaveBeenCalledWith(1, 'error');
    });

    it('filters logs after specific ID', () => {
      mockStmt.all.mockReturnValue([mockLogs[1]]);

      databaseManager.getTaskLogs(1, { after: 1 });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'SELECT * FROM task_logs WHERE task_id = ? AND id > ? ORDER BY timestamp ASC'
      );
      expect(mockStmt.all).toHaveBeenCalledWith(1, 1);
    });

    it('applies limit and offset', () => {
      mockStmt.all.mockReturnValue([mockLogs[0]]);

      databaseManager.getTaskLogs(1, { limit: 1, offset: 1 });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'SELECT * FROM task_logs WHERE task_id = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?'
      );
      expect(mockStmt.all).toHaveBeenCalledWith(1, 1, 1);
    });

    it('applies only limit when offset is 0', () => {
      mockStmt.all.mockReturnValue([mockLogs[0]]);

      databaseManager.getTaskLogs(1, { limit: 1, offset: 0 });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'SELECT * FROM task_logs WHERE task_id = ? ORDER BY timestamp ASC LIMIT ?'
      );
      expect(mockStmt.all).toHaveBeenCalledWith(1, 1);
    });

    it('ignores all level filter', () => {
      mockStmt.all.mockReturnValue(mockLogs);

      const result = databaseManager.getTaskLogs(1, { level: 'all' });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'SELECT * FROM task_logs WHERE task_id = ? ORDER BY timestamp ASC'
      );
      expect(result).toEqual(mockLogs);
    });
  });

  describe('getSetting', () => {
    it('returns setting when found', () => {
      const mockSetting: Setting = {
        key: 'branchPrefix',
        value: 'feature-',
        updated_at: '2023-01-01T00:00:00Z',
      };

      mockStmt.get.mockReturnValue(mockSetting);

      const result = databaseManager.getSetting('branchPrefix');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'SELECT * FROM settings WHERE key = ?'
      );
      expect(mockStmt.get).toHaveBeenCalledWith('branchPrefix');
      expect(result).toEqual(mockSetting);
    });

    it('returns null when setting not found', () => {
      mockStmt.get.mockReturnValue(null);

      const result = databaseManager.getSetting('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getSettings', () => {
    it('returns all settings', () => {
      const mockSettings: Setting[] = [
        {
          key: 'branchPrefix',
          value: 'feature-',
          updated_at: '2023-01-01T00:00:00Z',
        },
        {
          key: 'maxRetries',
          value: '3',
          updated_at: '2023-01-01T00:00:00Z',
        },
      ];

      mockStmt.all.mockReturnValue(mockSettings);

      const result = databaseManager.getSettings();

      expect(mockDb.prepare).toHaveBeenCalledWith('SELECT * FROM settings');
      expect(mockStmt.all).toHaveBeenCalledWith();
      expect(result).toEqual(mockSettings);
    });
  });

  describe('setSetting', () => {
    it('inserts or replaces setting', () => {
      databaseManager.setSetting('branchPrefix', 'feature-');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO settings')
      );
      expect(mockStmt.run).toHaveBeenCalledWith('branchPrefix', 'feature-');
    });
  });

  describe('addPrecommitCheck', () => {
    it('adds precommit check with all fields', () => {
      const mockCheck: Omit<PrecommitCheck, 'id' | 'created_at'> = {
        name: 'ESLint',
        command: 'npm run lint',
        order_index: 1,
      };

      mockStmt.run.mockReturnValue({ lastInsertRowid: 1 });

      const result = databaseManager.addPrecommitCheck(mockCheck);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO precommit_checks')
      );
      expect(mockStmt.run).toHaveBeenCalledWith('ESLint', 'npm run lint', 1);
      expect(result).toBe(1);
    });
  });

  describe('updatePrecommitCheck', () => {
    it('updates precommit check with provided fields', () => {
      const updates = {
        name: 'Updated ESLint',
        command: 'npm run lint:fix',
      };

      databaseManager.updatePrecommitCheck(1, updates);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE precommit_checks')
      );
      expect(mockStmt.run).toHaveBeenCalledWith(
        'Updated ESLint',
        'npm run lint:fix',
        1
      );
    });

    it('excludes id and created_at fields from updates', () => {
      const updates = {
        id: 999,
        created_at: '2023-01-01T00:00:00Z',
        name: 'Updated ESLint',
      };

      databaseManager.updatePrecommitCheck(1, updates);

      expect(mockStmt.run).toHaveBeenCalledWith('Updated ESLint', 1);
    });

    it('does not update when no valid fields provided', () => {
      // Clear mocks to ignore initialization calls
      jest.clearAllMocks();

      databaseManager.updatePrecommitCheck(1, {});

      expect(mockDb.prepare).not.toHaveBeenCalled();
      expect(mockStmt.run).not.toHaveBeenCalled();
    });
  });

  describe('deletePrecommitCheck', () => {
    it('deletes precommit check by id', () => {
      databaseManager.deletePrecommitCheck(1);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'DELETE FROM precommit_checks WHERE id = ?'
      );
      expect(mockStmt.run).toHaveBeenCalledWith(1);
    });
  });

  describe('getEnabledPrecommitChecks', () => {
    it('returns precommit checks ordered by order_index', () => {
      const mockChecks: PrecommitCheck[] = [
        {
          id: 1,
          name: 'ESLint',
          command: 'npm run lint',
          order_index: 1,
          created_at: '2023-01-01T00:00:00Z',
        },
        {
          id: 2,
          name: 'TypeScript',
          command: 'npm run type-check',
          order_index: 2,
          created_at: '2023-01-01T00:00:00Z',
        },
      ];

      mockStmt.all.mockReturnValue(mockChecks);

      const result = databaseManager.getEnabledPrecommitChecks();

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY order_index ASC')
      );
      expect(result).toEqual(mockChecks);
    });
  });

  describe('getAllPrecommitChecks', () => {
    it('returns all precommit checks ordered by order_index', () => {
      const mockChecks: PrecommitCheck[] = [
        {
          id: 1,
          name: 'ESLint',
          command: 'npm run lint',
          order_index: 1,
          created_at: '2023-01-01T00:00:00Z',
        },
      ];

      mockStmt.all.mockReturnValue(mockChecks);

      const result = databaseManager.getAllPrecommitChecks();

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY order_index ASC')
      );
      expect(result).toEqual(mockChecks);
    });
  });

  describe('close', () => {
    it('closes database connection', () => {
      databaseManager.close();

      expect(mockDb.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('handles database connection errors gracefully', () => {
      (Database as jest.MockedClass<typeof Database>).mockImplementationOnce(
        () => {
          throw new Error('Database connection failed');
        }
      );

      expect(() => new DatabaseManager()).toThrow('Database connection failed');
    });

    it('handles SQL execution errors gracefully', () => {
      const tempMockDb = {
        exec: jest.fn(() => {
          throw new Error('SQL execution failed');
        }),
        prepare: jest.fn().mockReturnValue(mockStmt),
        pragma: jest.fn(),
        close: jest.fn(),
      };

      (Database as jest.MockedClass<typeof Database>).mockImplementationOnce(
        () => tempMockDb as any
      );

      expect(() => new DatabaseManager()).toThrow('SQL execution failed');
    });

    it('handles statement preparation errors gracefully', () => {
      mockDb.prepare.mockImplementationOnce(() => {
        throw new Error('Statement preparation failed');
      });

      expect(() =>
        databaseManager.createTask({
          title: 'Test',
          description: 'Test',
          status: 'pending',
          coding_tool: 'amp',
          repository_path: '/test/repo',
        })
      ).toThrow('Statement preparation failed');
    });

    it('handles statement execution errors gracefully', () => {
      const errorStmt = {
        run: jest.fn(() => {
          throw new Error('Statement execution failed');
        }),
        get: jest.fn(),
        all: jest.fn(),
      };

      mockDb.prepare.mockReturnValueOnce(errorStmt as any);

      expect(() =>
        databaseManager.createTask({
          title: 'Test',
          description: 'Test',
          status: 'pending',
          coding_tool: 'amp',
          repository_path: '/test/repo',
        })
      ).toThrow('Statement execution failed');
    });
  });
});
