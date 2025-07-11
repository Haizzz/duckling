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
} from '../index';

describe('Types', () => {
  describe('Task', () => {
    it('should have correct structure', () => {
      const task: Task = {
        id: 1,
        title: 'Test Task',
        description: 'Test Description',
        status: 'pending',
        coding_tool: 'openai',
        repository_path: '/test/path',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
      };

      expect(task).toHaveProperty('id');
      expect(task).toHaveProperty('title');
      expect(task).toHaveProperty('description');
      expect(task).toHaveProperty('status');
      expect(task).toHaveProperty('coding_tool');
      expect(task).toHaveProperty('repository_path');
      expect(task).toHaveProperty('created_at');
      expect(task).toHaveProperty('updated_at');
    });

    it('should support optional fields', () => {
      const task: Task = {
        id: 1,
        title: 'Test Task',
        description: 'Test Description',
        summary: 'Test Summary',
        status: 'pending',
        coding_tool: 'openai',
        repository_path: '/test/path',
        current_stage: 'analysis',
        branch_name: 'test-branch',
        pr_number: 123,
        pr_url: 'https://github.com/test/repo/pull/123',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        completed_at: '2023-01-01T01:00:00Z',
      };

      expect(task.summary).toBe('Test Summary');
      expect(task.current_stage).toBe('analysis');
      expect(task.branch_name).toBe('test-branch');
      expect(task.pr_number).toBe(123);
      expect(task.pr_url).toBe('https://github.com/test/repo/pull/123');
      expect(task.completed_at).toBe('2023-01-01T01:00:00Z');
    });
  });

  describe('TaskStatus', () => {
    it('should include all valid status values', () => {
      const validStatuses: TaskStatus[] = [
        'pending',
        'in-progress',
        'awaiting-review',
        'addressing-review',
        'completed',
        'failed',
        'cancelled',
      ];

      validStatuses.forEach(status => {
        expect(typeof status).toBe('string');
      });
    });
  });

  describe('CodingTool', () => {
    it('should include all valid coding tools', () => {
      const validTools: CodingTool[] = ['openai', 'amp'];

      validTools.forEach(tool => {
        expect(typeof tool).toBe('string');
      });
    });
  });

  describe('TaskLog', () => {
    it('should have correct structure', () => {
      const taskLog: TaskLog = {
        id: 1,
        task_id: 1,
        level: 'info',
        message: 'Test log message',
        timestamp: '2023-01-01T00:00:00Z',
      };

      expect(taskLog).toHaveProperty('id');
      expect(taskLog).toHaveProperty('task_id');
      expect(taskLog).toHaveProperty('level');
      expect(taskLog).toHaveProperty('message');
      expect(taskLog).toHaveProperty('timestamp');
    });
  });

  describe('LogLevel', () => {
    it('should include all valid log levels', () => {
      const validLevels: LogLevel[] = ['info', 'error', 'debug', 'warn'];

      validLevels.forEach(level => {
        expect(typeof level).toBe('string');
      });
    });
  });

  describe('ApiResponse', () => {
    it('should handle success response', () => {
      const response: ApiResponse<string> = {
        success: true,
        data: 'test data',
      };

      expect(response.success).toBe(true);
      expect(response.data).toBe('test data');
    });

    it('should handle error response', () => {
      const response: ApiResponse = {
        success: false,
        error: 'test error',
      };

      expect(response.success).toBe(false);
      expect(response.error).toBe('test error');
    });
  });

  describe('CreateTaskRequest', () => {
    it('should have correct structure', () => {
      const request: CreateTaskRequest = {
        title: 'Test Task',
        description: 'Test Description',
        codingTool: 'openai',
        repositoryPath: '/test/path',
      };

      expect(request).toHaveProperty('title');
      expect(request).toHaveProperty('description');
      expect(request).toHaveProperty('codingTool');
      expect(request).toHaveProperty('repositoryPath');
    });

    it('should support optional fields', () => {
      const request: CreateTaskRequest = {
        title: 'Test Task',
        description: 'Test Description',
        codingTool: 'openai',
        repositoryPath: '/test/path',
        branchPrefix: 'feature/',
        prPrefix: '[FEATURE]',
      };

      expect(request.branchPrefix).toBe('feature/');
      expect(request.prPrefix).toBe('[FEATURE]');
    });
  });
});
