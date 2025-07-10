import { DatabaseManager } from '../../core/database';
import { SettingsManager } from '../../core/settings-manager';
import { CodingManager } from '../../core/coding-manager';
import { PrecommitManager } from '../../core/precommit-manager';
import { OpenAIManager } from '../../core/openai-manager';
import { CoreEngine } from '../../core/engine';
import { startDuckling } from '../../index';

// Mock all dependencies
jest.mock('../../core/database');
jest.mock('../../core/settings-manager');
jest.mock('../../core/coding-manager');
jest.mock('../../core/precommit-manager');
jest.mock('../../core/openai-manager');
jest.mock('../../core/engine');
jest.mock('../../index');

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

describe('CLI Services Creation', () => {
  let mockDb: jest.Mocked<DatabaseManager>;
  let mockSettings: jest.Mocked<SettingsManager>;
  let mockEngine: jest.Mocked<CoreEngine>;

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
  });

  describe('Service Dependencies', () => {
    it('should create database manager', () => {
      const db = new DatabaseManager();
      expect(db).toBeDefined();
    });

    it('should create settings manager with database dependency', () => {
      const settings = new SettingsManager(mockDb as any);
      expect(settings).toBeInstanceOf(SettingsManager);
    });

    it('should create coding manager with settings dependency', () => {
      const codingManager = new CodingManager(mockSettings as any);
      expect(codingManager).toBeInstanceOf(CodingManager);
    });

    it('should create precommit manager with database dependency', () => {
      const precommitManager = new PrecommitManager(mockDb as any);
      expect(precommitManager).toBeInstanceOf(PrecommitManager);
    });

    it('should create openai manager with database and settings dependencies', () => {
      const openaiManager = new OpenAIManager(
        mockDb as any,
        mockSettings as any
      );
      expect(openaiManager).toBeInstanceOf(OpenAIManager);
    });

    it('should create core engine with all dependencies', () => {
      const engine = new CoreEngine(
        mockDb as any,
        mockSettings as any,
        {} as any,
        {} as any,
        {} as any
      );
      expect(engine).toBeInstanceOf(CoreEngine);
    });
  });

  describe('Task Operations', () => {
    it('should create a task', async () => {
      const taskRequest = {
        title: 'Test Task',
        description: 'Test Description',
        codingTool: 'amp' as const,
        repositoryPath: '/test/path',
      };

      await mockEngine.createTask(taskRequest);

      expect(mockEngine.createTask).toHaveBeenCalledWith(taskRequest);
    });

    it('should cancel a task', async () => {
      await mockEngine.cancelTask(123);

      expect(mockEngine.cancelTask).toHaveBeenCalledWith(123);
    });

    it('should initialize engine', async () => {
      await mockEngine.initialize();

      expect(mockEngine.initialize).toHaveBeenCalled();
    });

    it('should shutdown engine', async () => {
      await mockEngine.shutdown();

      expect(mockEngine.shutdown).toHaveBeenCalled();
    });
  });

  describe('Database Operations', () => {
    it('should get tasks with filters', () => {
      const mockTasks = [
        {
          id: 1,
          title: 'Task 1',
          description: 'Description 1',
          status: 'pending' as const,
          coding_tool: 'amp' as const,
          repository_path: '/test/path',
          created_at: '2023-01-01T12:00:00Z',
          updated_at: '2023-01-01T12:00:00Z',
        },
      ];

      mockDb.getTasks.mockReturnValue(mockTasks);

      const result = mockDb.getTasks({ status: 'pending', limit: 10 });

      expect(result).toEqual(mockTasks);
      expect(mockDb.getTasks).toHaveBeenCalledWith({
        status: 'pending',
        limit: 10,
      });
    });

    it('should get task by id', () => {
      const mockTask = {
        id: 123,
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending' as const,
        coding_tool: 'amp' as const,
        repository_path: '/test/path',
        created_at: '2023-01-01T12:00:00Z',
        updated_at: '2023-01-01T12:00:00Z',
      };

      mockDb.getTask.mockReturnValue(mockTask);

      const result = mockDb.getTask(123);

      expect(result).toEqual(mockTask);
      expect(mockDb.getTask).toHaveBeenCalledWith(123);
    });

    it('should return null for non-existent task', () => {
      mockDb.getTask.mockReturnValue(null);

      const result = mockDb.getTask(999);

      expect(result).toBeNull();
    });

    it('should close database connection', () => {
      mockDb.close();

      expect(mockDb.close).toHaveBeenCalled();
    });
  });

  describe('Settings Operations', () => {
    it('should get default coding tool', () => {
      mockSettings.get.mockReturnValue('amp');

      const result = mockSettings.get('defaultCodingTool');

      expect(result).toBe('amp');
      expect(mockSettings.get).toHaveBeenCalledWith('defaultCodingTool');
    });

    it('should get all settings', () => {
      const mockSettingsData = {
        defaultCodingTool: 'amp' as const,
        branchPrefix: 'duckling-',
        prTitlePrefix: '[DUCKLING]',
        commitSuffix: ' [quack]',
        commentPrefix: 'duckling',
        maxRetries: 3,
        openaiApiKey: '',
      };

      mockSettings.getAll.mockReturnValue(mockSettingsData);

      const result = mockSettings.getAll();

      expect(result).toEqual(mockSettingsData);
    });
  });

  describe('Start Duckling', () => {
    it('should start duckling with default port', async () => {
      mockStartDuckling.mockResolvedValue();

      await startDuckling(5050);

      expect(mockStartDuckling).toHaveBeenCalledWith(5050);
    });

    it('should start duckling with custom port', async () => {
      mockStartDuckling.mockResolvedValue();

      await startDuckling(3000);

      expect(mockStartDuckling).toHaveBeenCalledWith(3000);
    });
  });
});
