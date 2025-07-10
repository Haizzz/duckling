import { Command } from 'commander';
import { DatabaseManager } from '../../core/database';
import { SettingsManager } from '../../core/settings-manager';
import { CodingManager } from '../../core/coding-manager';
import { PrecommitManager } from '../../core/precommit-manager';
import { OpenAIManager } from '../../core/openai-manager';
import { CoreEngine } from '../../core/engine';
import { startDuckling } from '../../index';
import * as readline from 'readline';

// Mock all dependencies
jest.mock('../../core/database');
jest.mock('../../core/settings-manager');
jest.mock('../../core/coding-manager');
jest.mock('../../core/precommit-manager');
jest.mock('../../core/openai-manager');
jest.mock('../../core/engine');
jest.mock('../../index');
jest.mock('readline');

const mockDatabaseManager = DatabaseManager as jest.MockedClass<
  typeof DatabaseManager
>;
const mockSettingsManager = SettingsManager as jest.MockedClass<
  typeof SettingsManager
>;
const mockCodingManager = CodingManager as jest.MockedClass<
  typeof CodingManager
>;
const mockPrecommitManager = PrecommitManager as jest.MockedClass<
  typeof PrecommitManager
>;
const mockOpenAIManager = OpenAIManager as jest.MockedClass<
  typeof OpenAIManager
>;
const mockCoreEngine = CoreEngine as jest.MockedClass<typeof CoreEngine>;
const mockStartDuckling = startDuckling as jest.MockedFunction<
  typeof startDuckling
>;
const mockReadline = readline as jest.Mocked<typeof readline>;

// Mock console methods
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();

describe('CLI', () => {
  let mockDb: jest.Mocked<DatabaseManager>;
  let mockSettings: jest.Mocked<SettingsManager>;
  let mockEngine: jest.Mocked<CoreEngine>;
  let mockRL: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock database
    mockDb = new mockDatabaseManager() as jest.Mocked<DatabaseManager>;

    // Mock settings
    mockSettings = new mockSettingsManager(
      mockDb as any
    ) as jest.Mocked<SettingsManager>;

    // Mock engine
    mockEngine = new mockCoreEngine(
      mockDb,
      mockSettings,
      {} as any,
      {} as any,
      {} as any
    ) as jest.Mocked<CoreEngine>;
    mockEngine.initialize.mockResolvedValue();
    mockEngine.createTask.mockResolvedValue(123);
    mockEngine.cancelTask.mockResolvedValue();
    mockEngine.shutdown.mockResolvedValue();

    // Mock readline
    mockRL = {
      question: jest.fn(),
      close: jest.fn(),
    };
    mockReadline.createInterface.mockReturnValue(mockRL);

    // Mock process.exit
    jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('start command', () => {
    it('should start duckling with default port', async () => {
      mockStartDuckling.mockResolvedValue();

      // Import and execute the CLI with start command
      const { program } = await import('../../cli/index');

      await program.parseAsync(['node', 'cli', 'start']);

      expect(mockStartDuckling).toHaveBeenCalledWith(5050);
    });

    it('should start duckling with custom port', async () => {
      mockStartDuckling.mockResolvedValue();

      const { program } = await import('../../cli/index');

      await program.parseAsync(['node', 'cli', 'start', '--port', '3000']);

      expect(mockStartDuckling).toHaveBeenCalledWith(3000);
    });

    it('should handle startup errors', async () => {
      const error = new Error('Startup failed');
      mockStartDuckling.mockRejectedValue(error);

      const { program } = await import('../../cli/index');

      await expect(
        program.parseAsync(['node', 'cli', 'start'])
      ).rejects.toThrow('process.exit called');

      expect(mockConsoleError).toHaveBeenCalledWith(
        '❌ Failed to start Duckling:',
        'Startup failed'
      );
    });
  });

  describe('config command', () => {
    it('should display configuration message', async () => {
      const { program } = await import('../../cli/index');

      await program.parseAsync(['node', 'cli', 'config']);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '💡 Use the web interface at http://localhost:5050/settings to configure Duckling'
      );
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should handle configuration errors', async () => {
      const error = new Error('Config failed');
      mockDb.close.mockImplementation(() => {
        throw error;
      });

      const { program } = await import('../../cli/index');

      await expect(
        program.parseAsync(['node', 'cli', 'config'])
      ).rejects.toThrow('process.exit called');

      expect(mockConsoleError).toHaveBeenCalledWith(
        '❌ Failed to check configuration:',
        'Config failed'
      );
    });
  });

  describe('task create command', () => {
    it('should create a task interactively', async () => {
      mockRL.question
        .mockResolvedValueOnce('Test Task')
        .mockResolvedValueOnce('Test Description')
        .mockResolvedValueOnce('amp');

      const { program } = await import('../../cli/index');

      await program.parseAsync(['node', 'cli', 'task', 'create']);

      expect(mockEngine.createTask).toHaveBeenCalledWith({
        title: 'Test Task',
        description: 'Test Description',
        codingTool: 'amp',
        repositoryPath: process.cwd(),
      });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '\n✅ Task created successfully!'
      );
      expect(mockConsoleLog).toHaveBeenCalledWith('📋 Task ID: 123');
      expect(mockRL.close).toHaveBeenCalled();
    });

    it('should handle empty title', async () => {
      mockRL.question.mockResolvedValueOnce('');

      const { program } = await import('../../cli/index');

      await program.parseAsync(['node', 'cli', 'task', 'create']);

      expect(mockConsoleLog).toHaveBeenCalledWith('❌ Task title is required');
      expect(mockRL.close).toHaveBeenCalled();
    });

    it('should handle empty description', async () => {
      mockRL.question
        .mockResolvedValueOnce('Test Task')
        .mockResolvedValueOnce('');

      const { program } = await import('../../cli/index');

      await program.parseAsync(['node', 'cli', 'task', 'create']);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '❌ Task description is required'
      );
      expect(mockRL.close).toHaveBeenCalled();
    });

    it('should handle invalid coding tool', async () => {
      mockRL.question
        .mockResolvedValueOnce('Test Task')
        .mockResolvedValueOnce('Test Description')
        .mockResolvedValueOnce('invalid');

      const { program } = await import('../../cli/index');

      await program.parseAsync(['node', 'cli', 'task', 'create']);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '❌ Invalid coding tool. Use: amp or openai'
      );
      expect(mockRL.close).toHaveBeenCalled();
    });

    it('should use default coding tool when empty', async () => {
      mockRL.question
        .mockResolvedValueOnce('Test Task')
        .mockResolvedValueOnce('Test Description')
        .mockResolvedValueOnce('');

      const { program } = await import('../../cli/index');

      await program.parseAsync(['node', 'cli', 'task', 'create']);

      expect(mockEngine.createTask).toHaveBeenCalledWith({
        title: 'Test Task',
        description: 'Test Description',
        codingTool: 'amp',
        repositoryPath: process.cwd(),
      });
    });

    it('should handle task creation errors', async () => {
      const error = new Error('Task creation failed');
      mockEngine.createTask.mockRejectedValue(error);

      mockRL.question
        .mockResolvedValueOnce('Test Task')
        .mockResolvedValueOnce('Test Description')
        .mockResolvedValueOnce('amp');

      const { program } = await import('../../cli/index');

      await expect(
        program.parseAsync(['node', 'cli', 'task', 'create'])
      ).rejects.toThrow('process.exit called');

      expect(mockConsoleError).toHaveBeenCalledWith(
        '❌ Failed to create task:',
        'Task creation failed'
      );
    });
  });

  describe('task list command', () => {
    it('should list tasks', async () => {
      const mockTasks = [
        {
          id: 1,
          title: 'Task 1',
          status: 'pending',
          coding_tool: 'amp',
          created_at: '2023-01-01T12:00:00Z',
        },
        {
          id: 2,
          title: 'Task 2',
          status: 'completed',
          coding_tool: 'openai',
          created_at: '2023-01-01T13:00:00Z',
          pr_url: 'https://github.com/test/pr/2',
        },
      ];

      mockDb.getTasks.mockReturnValue(mockTasks);

      const { program } = await import('../../cli/index');

      await program.parseAsync(['node', 'cli', 'task', 'list']);

      expect(mockDb.getTasks).toHaveBeenCalledWith({ limit: 10 });
      expect(mockConsoleLog).toHaveBeenCalledWith('📋 Found 2 task(s):\n');
      expect(mockConsoleLog).toHaveBeenCalledWith('⏳ Task 1');
      expect(mockConsoleLog).toHaveBeenCalledWith('✅ Task 2');
    });

    it('should handle empty task list', async () => {
      mockDb.getTasks.mockReturnValue([]);

      const { program } = await import('../../cli/index');

      await program.parseAsync(['node', 'cli', 'task', 'list']);

      expect(mockConsoleLog).toHaveBeenCalledWith('📭 No tasks found');
    });

    it('should filter tasks by status', async () => {
      mockDb.getTasks.mockReturnValue([]);

      const { program } = await import('../../cli/index');

      await program.parseAsync([
        'node',
        'cli',
        'task',
        'list',
        '--status',
        'pending',
      ]);

      expect(mockDb.getTasks).toHaveBeenCalledWith({
        limit: 10,
        status: 'pending',
      });
    });

    it('should handle custom limit', async () => {
      mockDb.getTasks.mockReturnValue([]);

      const { program } = await import('../../cli/index');

      await program.parseAsync(['node', 'cli', 'task', 'list', '--limit', '5']);

      expect(mockDb.getTasks).toHaveBeenCalledWith({ limit: 5 });
    });

    it('should handle list errors', async () => {
      const error = new Error('List failed');
      mockDb.getTasks.mockImplementation(() => {
        throw error;
      });

      const { program } = await import('../../cli/index');

      await expect(
        program.parseAsync(['node', 'cli', 'task', 'list'])
      ).rejects.toThrow('process.exit called');

      expect(mockConsoleError).toHaveBeenCalledWith(
        '❌ Failed to list tasks:',
        'List failed'
      );
    });
  });

  describe('task cancel command', () => {
    it('should cancel a task', async () => {
      const mockTask = {
        id: 123,
        title: 'Test Task',
        status: 'pending',
      };

      mockDb.getTask.mockReturnValue(mockTask);

      const { program } = await import('../../cli/index');

      await program.parseAsync(['node', 'cli', 'task', 'cancel', '123']);

      expect(mockDb.getTask).toHaveBeenCalledWith(123);
      expect(mockEngine.cancelTask).toHaveBeenCalledWith(123);
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '✅ Task cancelled: Test Task'
      );
    });

    it('should handle non-existent task', async () => {
      mockDb.getTask.mockReturnValue(undefined);

      const { program } = await import('../../cli/index');

      await program.parseAsync(['node', 'cli', 'task', 'cancel', '999']);

      expect(mockConsoleLog).toHaveBeenCalledWith('❌ Task not found: 999');
    });

    it('should handle already completed task', async () => {
      const mockTask = {
        id: 123,
        title: 'Test Task',
        status: 'completed',
      };

      mockDb.getTask.mockReturnValue(mockTask);

      const { program } = await import('../../cli/index');

      await program.parseAsync(['node', 'cli', 'task', 'cancel', '123']);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '❌ Cannot cancel task in status: completed'
      );
    });

    it('should handle cancel errors', async () => {
      const error = new Error('Cancel failed');
      const mockTask = {
        id: 123,
        title: 'Test Task',
        status: 'pending',
      };

      mockDb.getTask.mockReturnValue(mockTask);
      mockEngine.cancelTask.mockRejectedValue(error);

      const { program } = await import('../../cli/index');

      await expect(
        program.parseAsync(['node', 'cli', 'task', 'cancel', '123'])
      ).rejects.toThrow('process.exit called');

      expect(mockConsoleError).toHaveBeenCalledWith(
        '❌ Failed to cancel task:',
        'Cancel failed'
      );
    });
  });

  describe('status command', () => {
    it('should show system status', async () => {
      mockSettings.get.mockReturnValue('amp');
      mockDb.getTasks.mockReturnValue([]);

      const { program } = await import('../../cli/index');

      await program.parseAsync(['node', 'cli', 'status']);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '🔧 Duckling System Status\n'
      );
      expect(mockConsoleLog).toHaveBeenCalledWith('Configuration: ✅ Complete');
      expect(mockConsoleLog).toHaveBeenCalledWith('Default Tool: amp');
    });

    it('should show task statistics', async () => {
      mockSettings.get.mockReturnValue('amp');
      mockDb.getTasks
        .mockReturnValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }]) // all tasks
        .mockReturnValueOnce([{ id: 1 }]) // pending
        .mockReturnValueOnce([]) // in-progress
        .mockReturnValueOnce([{ id: 2 }]) // awaiting-review
        .mockReturnValueOnce([{ id: 3 }]) // completed
        .mockReturnValueOnce([]); // failed

      const { program } = await import('../../cli/index');

      await program.parseAsync(['node', 'cli', 'status']);

      expect(mockConsoleLog).toHaveBeenCalledWith('\n📊 Task Statistics:');
      expect(mockConsoleLog).toHaveBeenCalledWith('   Total: 3');
      expect(mockConsoleLog).toHaveBeenCalledWith('   Pending: 1');
      expect(mockConsoleLog).toHaveBeenCalledWith('   In Progress: 0');
      expect(mockConsoleLog).toHaveBeenCalledWith('   Awaiting Review: 1');
      expect(mockConsoleLog).toHaveBeenCalledWith('   Completed: 1');
      expect(mockConsoleLog).toHaveBeenCalledWith('   Failed: 0');
    });

    it('should handle status errors', async () => {
      const error = new Error('Status failed');
      mockSettings.get.mockImplementation(() => {
        throw error;
      });

      const { program } = await import('../../cli/index');

      await expect(
        program.parseAsync(['node', 'cli', 'status'])
      ).rejects.toThrow('process.exit called');

      expect(mockConsoleError).toHaveBeenCalledWith(
        '❌ Failed to get status:',
        'Status failed'
      );
    });
  });
});
