jest.mock('execa', () => ({
  execa: jest.fn().mockResolvedValue({
    stdout: 'success',
    stderr: '',
    exitCode: 0,
  }),
}));

import { CoreEngine } from '../engine';
import { DatabaseManager } from '../database';
import { SettingsManager } from '../settings-manager';
import { GitManager } from '../git-manager';
import { CodingManager } from '../coding-manager';
import { PrecommitManager } from '../precommit-manager';
import { GitHubManager } from '../github-manager';
import { OpenAIManager } from '../openai-manager';
import { taskExecutor } from '../task-executor';
import { CreateTaskRequest, Task, TaskStatus } from '../../types';
import { logger } from '../../utils/logger';
import { createMockInstance } from '../../utils/test-utils';

// Mock all dependencies
jest.mock('../database');
jest.mock('../settings-manager');
jest.mock('../git-manager');
jest.mock('../coding-manager');
jest.mock('../precommit-manager');
jest.mock('../pr-manager');
jest.mock('../openai-manager');
jest.mock('../task-executor');
jest.mock('../../utils/logger');

describe('CoreEngine', () => {
  let engine: CoreEngine;
  let mockDb: jest.Mocked<DatabaseManager>;
  let mockSettings: jest.Mocked<SettingsManager>;
  let mockGitManager: jest.Mocked<GitManager>;
  let mockCodingManager: jest.Mocked<CodingManager>;
  let mockPrecommitManager: jest.Mocked<PrecommitManager>;
  let mockGitHubManager: jest.Mocked<GitHubManager>;
  let mockOpenAIManager: jest.Mocked<OpenAIManager>;
  let mockTaskExecutor: jest.Mocked<typeof taskExecutor>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();

    // Create mock instances using createMockInstance
    mockDb = createMockInstance(DatabaseManager);
    mockSettings = createMockInstance(SettingsManager);
    mockGitManager = createMockInstance(GitManager);
    mockCodingManager = createMockInstance(CodingManager);
    mockPrecommitManager = createMockInstance(PrecommitManager);
    mockGitHubManager = createMockInstance(GitHubManager);
    mockOpenAIManager = createMockInstance(OpenAIManager);

    // Mock task executor
    mockTaskExecutor = {
      executeTask: jest.fn(),
    } as any;

    // Setup constructor mocks
    (SettingsManager as any).mockImplementation(() => mockSettings);
    (GitManager as any).mockImplementation(() => mockGitManager);
    (CodingManager as any).mockImplementation(() => mockCodingManager);
    (PrecommitManager as any).mockImplementation(() => mockPrecommitManager);
    (GitHubManager as any).mockImplementation(() => mockGitHubManager);
    (OpenAIManager as any).mockImplementation(() => mockOpenAIManager);
    (taskExecutor as any) = mockTaskExecutor;

    engine = new CoreEngine(mockDb);
  });

  afterEach(() => {
    engine.shutdown();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('initialize', () => {
    it('starts task processing and sets initialized flag', async () => {
      const startTaskProcessingSpy = jest.spyOn(
        engine as any,
        'startTaskProcessing'
      );

      await engine.initialize();

      expect(startTaskProcessingSpy).toHaveBeenCalled();
      expect((engine as any).isInitialized).toBe(true);
    });

    it('does not initialize twice when called multiple times', async () => {
      const startTaskProcessingSpy = jest.spyOn(
        engine as any,
        'startTaskProcessing'
      );

      await engine.initialize();
      await engine.initialize();

      expect(startTaskProcessingSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('createTask', () => {
    const mockRequest: CreateTaskRequest = {
      title: 'Test Task',
      description: 'Test description',
      codingTool: 'amp',
      repositoryPath: '/test/repo',
    };

    it('creates task with generated summary and returns task ID', async () => {
      mockOpenAIManager.generateTaskSummary.mockResolvedValue(
        'Generated summary'
      );
      mockDb.createTask.mockReturnValue(123);

      const taskId = await engine.createTask(mockRequest);

      expect(mockOpenAIManager.generateTaskSummary).toHaveBeenCalledWith(
        'Test description'
      );
      expect(mockDb.createTask).toHaveBeenCalledWith({
        title: 'Test Task',
        description: 'Test description',
        summary: 'Generated summary',
        status: 'pending',
        coding_tool: 'amp',
      });
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message: 'Task created: Test Task',
      });
      expect(taskId).toBe(123);
    });

    it('creates task without summary when OpenAI fails', async () => {
      mockOpenAIManager.generateTaskSummary.mockRejectedValue(
        new Error('OpenAI error')
      );
      mockDb.createTask.mockReturnValue(123);

      const taskId = await engine.createTask(mockRequest);

      expect(mockDb.createTask).toHaveBeenCalledWith({
        title: 'Test Task',
        description: 'Test description',
        summary: undefined,
        status: 'pending',
        coding_tool: 'amp',
      });
      expect(taskId).toBe(123);
    });

    it('emits task update event after creating task', async () => {
      mockDb.createTask.mockReturnValue(123);
      const emitSpy = jest.spyOn(engine, 'emit');

      await engine.createTask(mockRequest);

      expect(emitSpy).toHaveBeenCalledWith('task-update', {
        taskId: 123,
        status: 'pending',
        metadata: {
          task: undefined, // getTask returns undefined for new task
        },
      });
    });
  });

  describe('cancelTask', () => {
    const mockTask: Task = {
      id: 123,
      title: 'Test Task',
      description: 'Test description',
      status: 'pending',
      coding_tool: 'amp',
      repository_path: '/test/repo',
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z',
    };

    it('cancels existing task and updates status', async () => {
      mockDb.getTask.mockReturnValue(mockTask);

      await engine.cancelTask(123);

      expect(mockDb.updateTask).toHaveBeenCalledWith(123, {
        status: 'cancelled',
        current_stage: 'cancelled',
        completed_at: expect.any(String),
      });
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message: 'Task cancelled by user',
      });
    });

    it('throws error when task not found', async () => {
      mockDb.getTask.mockReturnValue(null);

      await expect(engine.cancelTask(123)).rejects.toThrow('Task not found');
    });

    it('emits task update event after cancelling', async () => {
      mockDb.getTask.mockReturnValue(mockTask);
      const emitSpy = jest.spyOn(engine, 'emit');

      await engine.cancelTask(123);

      expect(emitSpy).toHaveBeenCalledWith(
        'task-update',
        expect.objectContaining({
          taskId: 123,
          status: 'cancelled',
        })
      );
    });
  });

  describe('retryTask', () => {
    const mockFailedTask: Task = {
      id: 123,
      title: 'Test Task',
      description: 'Test description',
      status: 'failed',
      coding_tool: 'amp',
      repository_path: '/test/repo',
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z',
    };

    it('resets failed task to pending status', async () => {
      mockDb.getTask.mockReturnValue(mockFailedTask);

      await engine.retryTask(123);

      expect(mockDb.updateTask).toHaveBeenCalledWith(123, {
        status: 'pending',
      });
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message: 'Task retry requested',
      });
    });

    it('throws error when task not found', async () => {
      mockDb.getTask.mockReturnValue(null);

      await expect(engine.retryTask(123)).rejects.toThrow('Task not found');
    });

    it('throws error when task is not failed', async () => {
      const mockPendingTask = {
        ...mockFailedTask,
        status: 'pending' as TaskStatus,
      };
      mockDb.getTask.mockReturnValue(mockPendingTask);

      await expect(engine.retryTask(123)).rejects.toThrow(
        'Can only retry failed tasks'
      );
    });

    it('emits task update event after retry', async () => {
      mockDb.getTask.mockReturnValue(mockFailedTask);
      const emitSpy = jest.spyOn(engine, 'emit');

      await engine.retryTask(123);

      expect(emitSpy).toHaveBeenCalledWith(
        'task-update',
        expect.objectContaining({
          taskId: 123,
          status: 'pending',
        })
      );
    });
  });

  describe('task processing', () => {
    const mockPendingTask: Task = {
      id: 123,
      title: 'Test Task',
      description: 'Test description',
      status: 'pending',
      coding_tool: 'amp',
      repository_path: '/test/repo',
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z',
    };

    beforeEach(() => {
      // Mock task executor to call the execute function immediately
      mockTaskExecutor.executeTask.mockImplementation(async ({ execute }) => {
        await execute();
      });
    });

    it('processes pending tasks during initialization', async () => {
      mockDb.getTasks.mockReturnValue([mockPendingTask]);
      mockDb.getTask.mockReturnValue(mockPendingTask);
      mockOpenAIManager.generateBranchName.mockResolvedValue('feature-branch');
      mockGitManager.createAndCheckoutBranch.mockResolvedValue(
        'duckling-feature-branch'
      );
      mockPrecommitManager.runChecks.mockResolvedValue({
        passed: true,
        errors: [],
      });
      mockSettings.get.mockReturnValue('github-token');

      await engine.initialize();

      // Trigger the processing interval
      jest.advanceTimersByTime(60000);
      await Promise.resolve(); // Let async operations complete

      expect(mockDb.getTasks).toHaveBeenCalledWith({ status: 'pending' });
    });

    it('processes task through all stages successfully', async () => {
      mockDb.getTask.mockReturnValue(mockPendingTask);
      mockOpenAIManager.generateBranchName.mockResolvedValue('feature-branch');
      mockGitManager.createAndCheckoutBranch.mockResolvedValue(
        'duckling-feature-branch'
      );
      mockCodingManager.generateCode.mockResolvedValue('Generated code');
      mockPrecommitManager.runChecks.mockResolvedValue({
        passed: true,
        errors: [],
      });
      mockSettings.get.mockReturnValue('github-token');
      mockGitHubManager.createPRFromTask.mockResolvedValue({
        number: 1,
        url: 'https://github.com/test/pr/1',
      });

      await (engine as any).processTask(123);

      expect(mockDb.updateTask).toHaveBeenCalledWith(123, {
        status: 'in-progress',
        current_stage: 'creating_branch',
      });
      expect(mockOpenAIManager.generateBranchName).toHaveBeenCalledWith(
        'Test description',
        123
      );
      expect(mockGitManager.createAndCheckoutBranch).toHaveBeenCalledWith(
        'feature-branch',
        123
      );
      expect(mockCodingManager.generateCode).toHaveBeenCalledWith(
        'amp',
        'Test description',
        { taskId: 123 }
      );
      expect(mockPrecommitManager.runChecks).toHaveBeenCalledWith(123);
      expect(mockGitManager.commitChanges).toHaveBeenCalledWith(
        'Test description',
        123
      );
      expect(mockGitHubManager.createPRFromTask).toHaveBeenCalled();
    });

    it('handles precommit check failures with retry mechanism', async () => {
      mockDb.getTask.mockReturnValue(mockPendingTask);
      mockOpenAIManager.generateBranchName.mockResolvedValue('feature-branch');
      mockGitManager.createAndCheckoutBranch.mockResolvedValue(
        'duckling-feature-branch'
      );
      mockCodingManager.generateCode.mockResolvedValue('Generated code');
      mockPrecommitManager.runChecks
        .mockResolvedValueOnce({ passed: false, errors: ['Lint error'] })
        .mockResolvedValueOnce({ passed: true, errors: [] });
      mockCodingManager.requestFixes.mockResolvedValue('Fixed code');
      mockSettings.get.mockReturnValue('github-token');
      mockGitHubManager.createPRFromTask.mockResolvedValue({
        number: 1,
        url: 'https://github.com/test/pr/1',
      });

      await (engine as any).processTask(123);

      expect(mockCodingManager.requestFixes).toHaveBeenCalledWith(
        'amp',
        'Test description',
        ['Lint error'],
        { taskId: 123 }
      );
      expect(mockPrecommitManager.runChecks).toHaveBeenCalledTimes(2);
    });

    it('handles task failure and updates status', async () => {
      mockDb.getTask.mockReturnValue(mockPendingTask);
      mockOpenAIManager.generateBranchName.mockRejectedValue(
        new Error('Branch name generation failed')
      );

      await expect((engine as any).processTask(123)).rejects.toThrow(
        'Branch name generation failed'
      );

      expect(mockDb.updateTask).toHaveBeenCalledWith(123, {
        status: 'failed',
        current_stage: 'failed',
      });
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'error',
        message: '💥 Task failed: Branch name generation failed',
      });
    });

    it('skips processing when already processing', async () => {
      mockDb.getTasks.mockReturnValue([mockPendingTask]);
      (engine as any).isProcessing = true;

      await engine.initialize();

      // Trigger the processing interval
      jest.advanceTimersByTime(60000);
      await Promise.resolve();

      expect(logger.info).toHaveBeenCalledWith(
        'Processing already in progress, skipping cycle'
      );
    });
  });

  describe('review processing', () => {
    const mockAwaitingReviewTask: Task = {
      id: 123,
      title: 'Test Task',
      description: 'Test description',
      status: 'awaiting-review',
      coding_tool: 'amp',
      repository_path: '/test/repo',
      branch_name: 'duckling-feature-branch',
      pr_number: 1,
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z',
    };

    beforeEach(() => {
      mockTaskExecutor.executeTask.mockImplementation(async ({ execute }) => {
        await execute();
      });
    });

    it('processes PR comments and addresses feedback', async () => {
      mockDb.getTasks.mockImplementation((filter) => {
        if (filter?.status === 'awaiting-review')
          return [mockAwaitingReviewTask];
        if (filter?.status === 'pending') return [];
        return [];
      });
      mockDb.getTask.mockReturnValue(mockAwaitingReviewTask);
      mockSettings.get.mockImplementation((key) => {
        if (key === 'githubUsername') return 'github-username';
        if (key === 'githubToken') return 'github-token';
        return '';
      });
      mockGitManager.getLastCommitTimestamp.mockResolvedValue(
        '2023-01-01T12:00:00Z'
      );
      mockGitHubManager.pollForComments.mockResolvedValue([
        { id: '1', body: 'Please fix the formatting' },
        { id: '2', body: 'Add more tests' },
      ]);
      mockGitHubManager.getPRStatus.mockResolvedValue({
        merged: false,
        state: 'open',
        mergeable: true,
      });
      mockCodingManager.generateCode.mockResolvedValue('Fixed code');
      mockPrecommitManager.runChecks.mockResolvedValue({
        passed: true,
        errors: [],
      });

      // Initialize PR manager first
      (engine as any).getGitHubManager();

      // Directly call the review processing method instead of relying on timers
      await (engine as any).processReviews();

      expect(mockGitHubManager.pollForComments).toHaveBeenCalledWith(
        1,
        '2023-01-01T12:00:00Z',
        'github-username'
      );
      expect(mockCodingManager.generateCode).toHaveBeenCalledWith(
        'amp',
        expect.stringContaining('Please fix the formatting'),
        { taskId: 123 }
      );
    });

    it('updates task status when PR is merged', async () => {
      mockDb.getTasks.mockImplementation((filter) => {
        if (filter?.status === 'awaiting-review')
          return [mockAwaitingReviewTask];
        if (filter?.status === 'pending') return [];
        return [];
      });
      mockDb.getTask.mockReturnValue(mockAwaitingReviewTask);
      mockSettings.get.mockImplementation((key) => {
        if (key === 'githubUsername') return 'github-username';
        if (key === 'githubToken') return 'github-token';
        return '';
      });
      mockGitManager.getLastCommitTimestamp.mockResolvedValue(
        '2023-01-01T12:00:00Z'
      );
      mockGitHubManager.pollForComments.mockResolvedValue([]);
      mockGitHubManager.getPRStatus.mockResolvedValue({
        merged: true,
        state: 'closed',
        mergeable: null,
      });

      // Initialize PR manager first
      (engine as any).getGitHubManager();

      // Directly call the review processing method instead of relying on timers
      await (engine as any).processReviews();

      expect(mockDb.updateTask).toHaveBeenCalledWith(123, {
        status: 'completed',
        current_stage: 'completed',
        completed_at: expect.any(String),
      });
    });

    it('updates task status when PR is closed without merge', async () => {
      mockDb.getTasks.mockImplementation((filter) => {
        if (filter?.status === 'awaiting-review')
          return [mockAwaitingReviewTask];
        if (filter?.status === 'pending') return [];
        return [];
      });
      mockDb.getTask.mockReturnValue(mockAwaitingReviewTask);
      mockSettings.get.mockImplementation((key) => {
        if (key === 'githubUsername') return 'github-username';
        if (key === 'githubToken') return 'github-token';
        return '';
      });
      mockGitManager.getLastCommitTimestamp.mockResolvedValue(
        '2023-01-01T12:00:00Z'
      );
      mockGitHubManager.pollForComments.mockResolvedValue([]);
      mockGitHubManager.getPRStatus.mockResolvedValue({
        merged: false,
        state: 'closed',
        mergeable: null,
      });

      // Initialize PR manager first
      (engine as any).getGitHubManager();

      // Directly call the review processing method instead of relying on timers
      await (engine as any).processReviews();

      expect(mockDb.updateTask).toHaveBeenCalledWith(123, {
        status: 'cancelled',
        current_stage: 'cancelled',
      });
    });

    it('handles errors during review processing gracefully', async () => {
      mockDb.getTasks.mockReturnValue([mockAwaitingReviewTask]);
      mockDb.getTask.mockReturnValue(mockAwaitingReviewTask);
      mockGitManager.switchToBranch.mockRejectedValue(new Error('Git error'));

      await engine.initialize();

      // Trigger the processing interval
      jest.advanceTimersByTime(60000);
      await Promise.resolve();

      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'error',
        message: '❌ Error processing reviews: Git error',
      });
    });
  });

  describe('PR manager initialization', () => {
    it('initializes PR manager with GitHub token', () => {
      mockSettings.get.mockReturnValue('github-token');

      const prManager = (engine as any).getGitHubManager();

      expect(mockSettings.get).toHaveBeenCalledWith('githubToken');
      expect(GitHubManager).toHaveBeenCalledWith(
        'github-token',
        mockDb,
        mockOpenAIManager
      );
      expect(prManager).toBe(mockGitHubManager);
    });

    it('throws error when GitHub token not configured', () => {
      mockSettings.get.mockReturnValue('');

      expect(() => (engine as any).getGitHubManager()).toThrow(
        'GitHub token not configured'
      );
    });

    it('reuses existing PR manager instance', () => {
      mockSettings.get.mockReturnValue('github-token');

      const prManager1 = (engine as any).getGitHubManager();
      const prManager2 = (engine as any).getGitHubManager();

      expect(prManager1).toBe(prManager2);
      expect(GitHubManager).toHaveBeenCalledTimes(1);
    });
  });

  describe('shutdown', () => {
    it('clears processing interval and removes event listeners', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      const removeAllListenersSpy = jest.spyOn(engine, 'removeAllListeners');

      // Initialize to create the interval
      engine.initialize();
      const interval = (engine as any).processingInterval;

      engine.shutdown();

      expect(clearIntervalSpy).toHaveBeenCalledWith(interval);
      expect((engine as any).processingInterval).toBeUndefined();
      expect(removeAllListenersSpy).toHaveBeenCalled();
    });

    it('handles shutdown when not initialized', () => {
      const removeAllListenersSpy = jest.spyOn(engine, 'removeAllListeners');

      engine.shutdown();

      expect(removeAllListenersSpy).toHaveBeenCalled();
    });
  });

  describe('event emission', () => {
    it('emits task update events with full task data', () => {
      const mockTask: Task = {
        id: 123,
        title: 'Test Task',
        description: 'Test description',
        status: 'pending',
        coding_tool: 'amp',
        repository_path: '/test/repo',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
      };
      mockDb.getTask.mockReturnValue(mockTask);
      const emitSpy = jest.spyOn(engine, 'emit');

      (engine as any).emitTaskUpdate(123, 'in-progress', { extra: 'data' });

      expect(emitSpy).toHaveBeenCalledWith('task-update', {
        taskId: 123,
        status: 'in-progress',
        metadata: {
          extra: 'data',
          task: mockTask,
        },
      });
    });
  });

  describe('timeout-based processing', () => {
    it('sets up processing interval with correct timing', async () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      await engine.initialize();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60000);
    });

    it('processes both reviews and tasks in correct order', async () => {
      const processReviewsSpy = jest
        .spyOn(engine as any, 'processReviews')
        .mockResolvedValue(undefined);
      const processPendingTasksSpy = jest
        .spyOn(engine as any, 'processPendingTasks')
        .mockResolvedValue(undefined);

      await engine.initialize();

      // Trigger the processing interval
      jest.advanceTimersByTime(60000);
      await Promise.resolve();

      expect(processReviewsSpy).toHaveBeenCalled();
      expect(processPendingTasksSpy).toHaveBeenCalled();
    });
  });
});
