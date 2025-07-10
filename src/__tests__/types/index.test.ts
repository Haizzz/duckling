import {
  Task,
  TaskStatus,
  CodingTool,
  TaskLog,
  LogLevel,
  Setting,
  PrecommitCheck,
  Repository,
  DucklingSettings,
  TaskUpdateEvent,
  ApiResponse,
  CreateTaskRequest,
} from '../../types';

describe('Types', () => {
  describe('TaskStatus', () => {
    it('should have correct values', () => {
      const validStatuses: TaskStatus[] = [
        'pending',
        'in-progress',
        'awaiting-review',
        'completed',
        'failed',
        'cancelled',
      ];

      validStatuses.forEach((status) => {
        expect(typeof status).toBe('string');
      });
    });
  });

  describe('CodingTool', () => {
    it('should have correct values', () => {
      const validTools: CodingTool[] = ['openai', 'amp'];

      validTools.forEach((tool) => {
        expect(typeof tool).toBe('string');
      });
    });
  });

  describe('LogLevel', () => {
    it('should have correct values', () => {
      const validLevels: LogLevel[] = ['info', 'error', 'debug', 'warn'];

      validLevels.forEach((level) => {
        expect(typeof level).toBe('string');
      });
    });
  });

  describe('Task interface', () => {
    it('should create a valid task object', () => {
      const task: Task = {
        id: 1,
        title: 'Test Task',
        description: 'Test Description',
        summary: 'Test Summary',
        status: 'pending',
        coding_tool: 'amp',
        repository_path: '/test/path',
        current_stage: 'initial',
        branch_name: 'test-branch',
        pr_number: 123,
        pr_url: 'https://github.com/test/repo/pull/123',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        completed_at: '2023-01-01T01:00:00Z',
      };

      expect(task.id).toBe(1);
      expect(task.title).toBe('Test Task');
      expect(task.status).toBe('pending');
      expect(task.coding_tool).toBe('amp');
    });
  });

  describe('TaskLog interface', () => {
    it('should create a valid task log object', () => {
      const log: TaskLog = {
        id: 1,
        task_id: 1,
        level: 'info',
        message: 'Test log message',
        timestamp: '2023-01-01T00:00:00Z',
      };

      expect(log.id).toBe(1);
      expect(log.task_id).toBe(1);
      expect(log.level).toBe('info');
      expect(log.message).toBe('Test log message');
    });
  });

  describe('ApiResponse interface', () => {
    it('should create a valid success response', () => {
      const response: ApiResponse<string> = {
        success: true,
        data: 'test data',
      };

      expect(response.success).toBe(true);
      expect(response.data).toBe('test data');
      expect(response.error).toBeUndefined();
    });

    it('should create a valid error response', () => {
      const response: ApiResponse = {
        success: false,
        error: 'test error',
      };

      expect(response.success).toBe(false);
      expect(response.error).toBe('test error');
      expect(response.data).toBeUndefined();
    });
  });

  describe('CreateTaskRequest interface', () => {
    it('should create a valid request object', () => {
      const request: CreateTaskRequest = {
        title: 'Test Task',
        description: 'Test Description',
        codingTool: 'amp',
        repositoryPath: '/test/path',
        branchPrefix: 'test-',
        prPrefix: '[TEST]',
      };

      expect(request.title).toBe('Test Task');
      expect(request.codingTool).toBe('amp');
      expect(request.branchPrefix).toBe('test-');
    });
  });
});
