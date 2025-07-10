import request from 'supertest';
import express from 'express';
import { createRoutes } from '../../api/routes';
import { DatabaseManager } from '../../core/database';
import { CoreEngine } from '../../core/engine';
import { SettingsManager } from '../../core/settings-manager';
import { Task } from '../../types';

// Mock dependencies
jest.mock('../../core/database');
jest.mock('../../core/engine');
jest.mock('../../core/settings-manager');
jest.mock('fs');
jest.mock('child_process');

const mockDatabaseManager = DatabaseManager as jest.MockedClass<
  typeof DatabaseManager
>;
const mockCoreEngine = CoreEngine as jest.MockedClass<typeof CoreEngine>;
const mockSettingsManager = SettingsManager as jest.MockedClass<
  typeof SettingsManager
>;

describe('API Routes', () => {
  let app: express.Application;
  let mockDb: jest.Mocked<DatabaseManager>;
  let mockEngine: jest.Mocked<CoreEngine>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDb = new mockDatabaseManager() as jest.Mocked<DatabaseManager>;
    mockEngine = new mockCoreEngine(
      mockDb,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    ) as jest.Mocked<CoreEngine>;

    app = express();
    app.use(express.json());
    app.use('/api', createRoutes(mockDb, mockEngine));
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: {
          status: 'healthy',
          timestamp: expect.any(String),
        },
      });
    });
  });

  describe('GET /tasks', () => {
    it('should return paginated tasks', async () => {
      const mockTasks: Task[] = [
        {
          id: 1,
          title: 'Task 1',
          description: 'Description 1',
          status: 'pending',
          coding_tool: 'amp',
          repository_path: '/test/path',
          created_at: '2023-01-01T12:00:00Z',
          updated_at: '2023-01-01T12:00:00Z',
        },
        {
          id: 2,
          title: 'Task 2',
          description: 'Description 2',
          status: 'completed',
          coding_tool: 'openai',
          repository_path: '/test/path',
          created_at: '2023-01-01T13:00:00Z',
          updated_at: '2023-01-01T13:00:00Z',
        },
      ];

      mockDb.getTasks.mockReturnValue(mockTasks);

      const response = await request(app).get('/api/tasks');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: {
          tasks: mockTasks,
          pagination: {
            currentPage: 1,
            limit: 10,
            total: 2,
            totalPages: 1,
          },
        },
      });
    });

    it('should handle pagination parameters', async () => {
      const mockTasks: Task[] = [];
      mockDb.getTasks.mockReturnValue(mockTasks);

      const response = await request(app).get('/api/tasks?page=2&limit=5');

      expect(response.status).toBe(200);
      expect(mockDb.getTasks).toHaveBeenCalledWith({
        status: undefined,
        limit: 5,
        offset: 5,
      });
    });

    it('should filter tasks by status', async () => {
      const mockTasks: Task[] = [];
      mockDb.getTasks.mockReturnValue(mockTasks);

      const response = await request(app).get('/api/tasks?status=pending');

      expect(response.status).toBe(200);
      expect(mockDb.getTasks).toHaveBeenCalledWith({
        status: 'pending',
        limit: 10,
        offset: 0,
      });
    });

    it('should handle database errors', async () => {
      mockDb.getTasks.mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = await request(app).get('/api/tasks');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        error: 'Database error',
      });
    });
  });

  describe('POST /tasks', () => {
    it('should create a new task', async () => {
      const mockRepository = {
        id: 1,
        path: '/test/path',
        name: 'test-repo',
        owner: 'test-owner',
        created_at: '2023-01-01T12:00:00Z',
      };

      mockDb.getRepository.mockReturnValue(mockRepository);
      mockDb.getSetting.mockReturnValue({
        key: 'defaultCodingTool',
        value: 'amp',
        updated_at: '2023-01-01T12:00:00Z',
      });
      mockEngine.createTask.mockResolvedValue(123);

      const response = await request(app).post('/api/tasks').send({
        description: 'Test task description',
        repositoryPath: '/test/path',
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: { taskId: 123 },
      });
      expect(mockEngine.createTask).toHaveBeenCalledWith({
        title: 'Test task description',
        description: 'Test task description',
        codingTool: 'amp',
        repositoryPath: '/test/path',
      });
    });

    it('should truncate long titles', async () => {
      const longDescription = 'A'.repeat(100);
      const mockRepository = {
        id: 1,
        path: '/test/path',
        name: 'test-repo',
        owner: 'test-owner',
        created_at: '2023-01-01T12:00:00Z',
      };

      mockDb.getRepository.mockReturnValue(mockRepository);
      mockDb.getSetting.mockReturnValue({
        key: 'defaultCodingTool',
        value: 'amp',
        updated_at: '2023-01-01T12:00:00Z',
      });
      mockEngine.createTask.mockResolvedValue(123);

      const response = await request(app).post('/api/tasks').send({
        description: longDescription,
        repositoryPath: '/test/path',
      });

      expect(response.status).toBe(200);
      expect(mockEngine.createTask).toHaveBeenCalledWith({
        title: 'A'.repeat(50) + '...',
        description: longDescription,
        codingTool: 'amp',
        repositoryPath: '/test/path',
      });
    });

    it('should return 400 for missing description', async () => {
      const response = await request(app).post('/api/tasks').send({
        repositoryPath: '/test/path',
      });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: 'Missing required field: description',
      });
    });

    it('should return 400 for missing repositoryPath', async () => {
      const response = await request(app).post('/api/tasks').send({
        description: 'Test description',
      });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: 'Missing required field: repositoryPath',
      });
    });

    it('should return 400 for non-existent repository', async () => {
      mockDb.getRepository.mockReturnValue(null);

      const response = await request(app).post('/api/tasks').send({
        description: 'Test description',
        repositoryPath: '/non/existent/path',
      });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: 'Repository not found. Please add the repository first.',
      });
    });

    it('should handle engine errors', async () => {
      const mockRepository = {
        id: 1,
        path: '/test/path',
        name: 'test-repo',
        owner: 'test-owner',
        created_at: '2023-01-01T12:00:00Z',
      };

      mockDb.getRepository.mockReturnValue(mockRepository);
      mockDb.getSetting.mockReturnValue({
        key: 'defaultCodingTool',
        value: 'amp',
        updated_at: '2023-01-01T12:00:00Z',
      });
      mockEngine.createTask.mockRejectedValue(new Error('Engine error'));

      const response = await request(app).post('/api/tasks').send({
        description: 'Test description',
        repositoryPath: '/test/path',
      });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        error: 'Engine error',
      });
    });
  });

  describe('GET /tasks/:id', () => {
    it('should return a specific task', async () => {
      const mockTask: Task = {
        id: 123,
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending',
        coding_tool: 'amp',
        repository_path: '/test/path',
        created_at: '2023-01-01T12:00:00Z',
        updated_at: '2023-01-01T12:00:00Z',
      };

      mockDb.getTask.mockReturnValue(mockTask);

      const response = await request(app).get('/api/tasks/123');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: mockTask,
      });
      expect(mockDb.getTask).toHaveBeenCalledWith(123);
    });

    it('should return 404 for non-existent task', async () => {
      mockDb.getTask.mockReturnValue(null);

      const response = await request(app).get('/api/tasks/999');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        success: false,
        error: 'Task not found',
      });
    });

    it('should handle database errors', async () => {
      mockDb.getTask.mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = await request(app).get('/api/tasks/123');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        error: 'Database error',
      });
    });
  });

  describe('PUT /tasks/:id', () => {
    it('should update a task', async () => {
      const mockTask: Task = {
        id: 123,
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending',
        coding_tool: 'amp',
        repository_path: '/test/path',
        created_at: '2023-01-01T12:00:00Z',
        updated_at: '2023-01-01T12:00:00Z',
      };

      mockDb.getTask.mockReturnValue(mockTask);

      const response = await request(app).put('/api/tasks/123').send({
        status: 'completed',
        completed_at: '2023-01-01T13:00:00Z',
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: { message: 'Task updated successfully' },
      });
      expect(mockDb.updateTask).toHaveBeenCalledWith(123, {
        status: 'completed',
        completed_at: '2023-01-01T13:00:00Z',
      });
    });

    it('should return 404 for non-existent task', async () => {
      mockDb.getTask.mockReturnValue(null);

      const response = await request(app).put('/api/tasks/999').send({
        status: 'completed',
      });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        success: false,
        error: 'Task not found',
      });
    });
  });
});
