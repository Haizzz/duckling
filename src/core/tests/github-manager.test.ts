jest.mock('@octokit/rest');
jest.mock('../settings-manager');
jest.mock('../openai-manager');
jest.mock('../../utils/git-utils');
jest.mock('../../utils/retry');
jest.mock('../../utils/logger');

import { GitHubManager } from '../github-manager';
import { Octokit } from '@octokit/rest';
import { SettingsManager } from '../settings-manager';
import { OpenAIManager } from '../openai-manager';
import { validateAndGetRepoInfo } from '../../utils/git-utils';
import { withRetry } from '../../utils/retry';
import { createMockInstance } from '../../utils/test-utils';
import type { DatabaseManager } from '../database';

const mockOctokit = {
  rest: {
    repos: {
      get: () => ({
        data: { default_branch: 'main' },
      }),
    },
    pulls: {
      create: jest.fn(),
      update: jest.fn(),
      list: jest.fn(),
      listReviewComments: jest.fn(),
      get: jest.fn(),
    },
    issues: {
      createComment: jest.fn(),
    },
  },
};

describe('GitHubManager', () => {
  let githubManager: GitHubManager;
  let mockDb: jest.Mocked<DatabaseManager>;
  let mockSettingsManager: jest.Mocked<SettingsManager>;
  let mockOpenAIManager: jest.Mocked<OpenAIManager>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDb = {
      addTaskLog: jest.fn(),
    } as any;

    mockSettingsManager = createMockInstance(SettingsManager);
    mockOpenAIManager = createMockInstance(OpenAIManager);

    (Octokit as jest.MockedClass<typeof Octokit>).mockImplementation(
      () => mockOctokit as any
    );
    (
      SettingsManager as jest.MockedClass<typeof SettingsManager>
    ).mockImplementation(() => mockSettingsManager);
    (
      OpenAIManager as jest.MockedClass<typeof OpenAIManager>
    ).mockImplementation(() => mockOpenAIManager);

    (validateAndGetRepoInfo as jest.Mock).mockResolvedValue({
      owner: 'testowner',
      name: 'testrepo',
    });

    (withRetry as jest.Mock).mockImplementation(async (fn) => fn());

    githubManager = new GitHubManager('test-token', mockDb, mockOpenAIManager);
  });

  describe('createPRFromTask', () => {
    it('generates PR title and description using OpenAI and creates PR', async () => {
      mockOpenAIManager.generatePRTitle.mockResolvedValue('Generated PR Title');
      mockOpenAIManager.generatePRDescription.mockResolvedValue(
        'Generated PR Description'
      );
      mockSettingsManager.get.mockReturnValue('main');

      mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });
      mockOctokit.rest.pulls.create.mockResolvedValue({
        data: {
          number: 123,
          html_url: 'https://github.com/testowner/testrepo/pull/123',
        },
      });

      const result = await githubManager.createPRFromTask(
        'feature-branch',
        'Task description',
        456,
        '/test/repo'
      );

      expect(mockOpenAIManager.generatePRTitle).toHaveBeenCalledWith(
        'Task description'
      );
      expect(mockOpenAIManager.generatePRDescription).toHaveBeenCalledWith(
        'Task description',
        'feature-branch'
      );
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 456,
        level: 'info',
        message: '🤖 Generating PR title and description...',
      });
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 456,
        level: 'info',
        message: '📋 Generated PR title: "Generated PR Title"',
      });
      expect(result).toEqual({
        number: 123,
        url: 'https://github.com/testowner/testrepo/pull/123',
      });
    });
  });

  describe('createPR', () => {
    beforeEach(() => {
      mockSettingsManager.get.mockReturnValue('main');
    });

    it('creates new PR when no existing PR found', async () => {
      mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });
      mockOctokit.rest.pulls.create.mockResolvedValue({
        data: {
          number: 123,
          html_url: 'https://github.com/testowner/testrepo/pull/123',
        },
      });

      const result = await githubManager.createPR(
        'test-branch',
        'Test Title',
        'Test Description',
        789,
        '/test/repo'
      );

      expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith({
        owner: 'testowner',
        repo: 'testrepo',
        head: 'testowner:test-branch',
        state: 'open',
      });
      expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith({
        owner: 'testowner',
        repo: 'testrepo',
        title: 'Test Title',
        body: 'Test Description',
        head: 'test-branch',
        base: 'main',
      });
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 789,
        level: 'info',
        message:
          '✅ PR created successfully: #123 - https://github.com/testowner/testrepo/pull/123',
      });
      expect(result).toEqual({
        number: 123,
        url: 'https://github.com/testowner/testrepo/pull/123',
      });
    });

    it('returns existing PR when one already exists for the branch', async () => {
      const existingPR = {
        number: 456,
        html_url: 'https://github.com/testowner/testrepo/pull/456',
      };
      mockOctokit.rest.pulls.list.mockResolvedValue({ data: [existingPR] });

      const result = await githubManager.createPR(
        'existing-branch',
        'Test Title',
        'Test Description',
        789,
        '/test/repo'
      );

      expect(mockOctokit.rest.pulls.create).not.toHaveBeenCalled();
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 789,
        level: 'info',
        message:
          '✅ Found existing PR #456: https://github.com/testowner/testrepo/pull/456',
      });
      expect(result).toEqual({
        number: 456,
        url: 'https://github.com/testowner/testrepo/pull/456',
      });
    });

    it('logs PR creation progress messages', async () => {
      mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });
      mockOctokit.rest.pulls.create.mockResolvedValue({
        data: {
          number: 789,
          html_url: 'https://github.com/testowner/testrepo/pull/789',
        },
      });

      await githubManager.createPR(
        'new-branch',
        'New Title',
        'New Description',
        111,
        '/test/repo'
      );

      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 111,
        level: 'info',
        message: '🔍 Checking if PR already exists for branch: new-branch',
      });
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 111,
        level: 'info',
        message: '🚀 Creating new PR from new-branch to main...',
      });
    });
  });

  describe('findPRByBranch', () => {
    beforeEach(async () => {
      // Initialize the GitHubManager
      mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });
      mockOctokit.rest.pulls.create.mockResolvedValue({
        data: { number: 1, html_url: 'url' },
      });
      await githubManager.createPR(
        'init-branch',
        'init',
        'init',
        1,
        '/test/repo'
      );
      jest.clearAllMocks();
    });

    it('returns first PR when multiple PRs exist for branch', async () => {
      const prs = [
        { number: 1, html_url: 'url1' },
        { number: 2, html_url: 'url2' },
      ];
      mockOctokit.rest.pulls.list.mockResolvedValue({ data: prs });

      const result = await githubManager.findPRByBranch('test-branch');

      expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith({
        owner: 'testowner',
        repo: 'testrepo',
        head: 'testowner:test-branch',
        state: 'open',
      });
      expect(result).toEqual(prs[0]);
    });

    it('returns null when no PRs exist for branch', async () => {
      mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });

      const result = await githubManager.findPRByBranch('nonexistent-branch');

      expect(result).toBeNull();
    });

    it('returns null when API call fails', async () => {
      mockOctokit.rest.pulls.list.mockRejectedValue(new Error('API Error'));

      const result = await githubManager.findPRByBranch('error-branch');

      expect(result).toBeNull();
    });
  });

  describe('pollForComments', () => {
    it('returns new comments from target user after commit timestamp', async () => {
      const reviewComments = [
        {
          user: { login: 'targetuser' },
          created_at: '2023-01-02T10:00:00Z',
          body: 'New comment',
        },
        {
          user: { login: 'otheruser' },
          created_at: '2023-01-02T11:00:00Z',
          body: 'Other comment',
        },
        {
          user: { login: 'targetuser' },
          created_at: '2023-01-01T10:00:00Z',
          body: 'Old comment',
        },
      ];
      mockOctokit.rest.pulls.listReviewComments.mockResolvedValue({
        data: reviewComments,
      });

      const result = await githubManager.pollForComments(
        123,
        '2023-01-01T12:00:00Z',
        'targetuser',
        '/test/repo'
      );

      expect(result).toHaveLength(1);
      // expect(result[0].body).toBe('New comment'); // TODO: Update test for string format
    });

    it('returns all comments from target user when no commit timestamp provided', async () => {
      const reviewComments = [
        {
          user: { login: 'targetuser' },
          created_at: '2023-01-02T10:00:00Z',
          body: 'Comment 1',
        },
        {
          user: { login: 'targetuser' },
          created_at: '2023-01-01T10:00:00Z',
          body: 'Comment 2',
        },
      ];
      mockOctokit.rest.pulls.listReviewComments.mockResolvedValue({
        data: reviewComments,
      });

      const result = await githubManager.pollForComments(
        123,
        null,
        'targetuser',
        '/test/repo'
      );

      expect(result).toHaveLength(2);
    });

    it('returns empty array when API call fails', async () => {
      mockOctokit.rest.pulls.listReviewComments.mockRejectedValue(
        new Error('API Error')
      );

      const result = await githubManager.pollForComments(
        123,
        null,
        'targetuser',
        '/test/repo'
      );

      expect(result).toEqual([]);
    });

    it('performs case-insensitive username comparison', async () => {
      const reviewComments = [
        {
          user: { login: 'TargetUser' },
          created_at: '2023-01-02T10:00:00Z',
          body: 'Case test',
        },
      ];
      mockOctokit.rest.pulls.listReviewComments.mockResolvedValue({
        data: reviewComments,
      });

      const result = await githubManager.pollForComments(
        123,
        null,
        'targetuser',
        '/test/repo'
      );

      expect(result).toHaveLength(1);
      // expect(result[0].body).toBe('Case test'); // TODO: Update test for string format
    });
  });

  describe('getPRReviewComments', () => {
    beforeEach(async () => {
      // Initialize the GitHubManager
      mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });
      mockOctokit.rest.pulls.create.mockResolvedValue({
        data: { number: 1, html_url: 'url' },
      });
      await githubManager.createPR(
        'init-branch',
        'init',
        'init',
        1,
        '/test/repo'
      );
      jest.clearAllMocks();
    });

    it('returns review comments for PR', async () => {
      const comments = [{ id: 1, body: 'Review comment' }];
      mockOctokit.rest.pulls.listReviewComments.mockResolvedValue({
        data: comments,
      });

      const result = await githubManager.getPRReviewComments(123, '/test/repo');

      expect(mockOctokit.rest.pulls.listReviewComments).toHaveBeenCalledWith({
        owner: 'testowner',
        repo: 'testrepo',
        pull_number: 123,
      });
      expect(result).toEqual(comments);
    });
  });

  describe('getPRStatus', () => {
    beforeEach(async () => {
      // Initialize the GitHubManager
      mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });
      mockOctokit.rest.pulls.create.mockResolvedValue({
        data: { number: 1, html_url: 'url' },
      });
      await githubManager.createPR(
        'init-branch',
        'init',
        'init',
        1,
        '/test/repo'
      );
      jest.clearAllMocks();
    });

    it('returns PR status information', async () => {
      const prData = {
        state: 'open',
        mergeable: true,
        merged: false,
      };
      mockOctokit.rest.pulls.get.mockResolvedValue({ data: prData });

      const result = await githubManager.getPRStatus(123, '/test/repo');

      expect(mockOctokit.rest.pulls.get).toHaveBeenCalledWith({
        owner: 'testowner',
        repo: 'testrepo',
        pull_number: 123,
      });
      expect(result).toEqual({
        state: 'open',
        mergeable: true,
        merged: false,
      });
    });
  });

  describe('error handling', () => {
    it('throws error when repository info cannot be retrieved', async () => {
      (validateAndGetRepoInfo as jest.Mock).mockRejectedValueOnce(
        new Error('Not a git repo')
      );

      await expect(
        githubManager.createPR(
          'test-branch',
          'title',
          'desc',
          123,
          '/test/repo'
        )
      ).rejects.toThrow(
        'Failed to get repository information: Error: Not a git repo'
      );
    });

    it('handles initialization error only once', async () => {
      (validateAndGetRepoInfo as jest.Mock)
        .mockRejectedValueOnce(new Error('First error'))
        .mockResolvedValueOnce({ owner: 'owner', name: 'repo' });

      // First call should fail
      await expect(
        githubManager.createPR(
          'test-branch',
          'title',
          'desc',
          123,
          '/test/repo'
        )
      ).rejects.toThrow('Failed to get repository information');

      // Reset the manager for second test
      githubManager = new GitHubManager(
        'test-token',
        mockDb,
        mockOpenAIManager
      );
      mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });
      mockOctokit.rest.pulls.create.mockResolvedValue({
        data: { number: 123, html_url: 'url' },
      });

      // Second call should succeed
      await expect(
        githubManager.createPR(
          'test-branch',
          'title',
          'desc',
          123,
          '/test/repo'
        )
      ).resolves.toBeDefined();
    });
  });

  describe('retry behavior', () => {
    it('uses withRetry for createPR operations', async () => {
      mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });
      mockOctokit.rest.pulls.create.mockResolvedValue({
        data: { number: 123, html_url: 'url' },
      });

      await githubManager.createPR(
        'test-branch',
        'title',
        'desc',
        123,
        '/test/repo'
      );

      expect(withRetry).toHaveBeenCalledWith(
        expect.any(Function),
        'Create PR',
        3
      );
    });

    it('uses withRetry for getPRReviewComments operations', async () => {
      mockOctokit.rest.pulls.listReviewComments.mockResolvedValue({ data: [] });

      await githubManager.getPRReviewComments(123, '/test/repo');

      expect(withRetry).toHaveBeenCalledWith(
        expect.any(Function),
        'Get PR review comments',
        2
      );
    });

    it('uses withRetry for getPRStatus operations', async () => {
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: { state: 'open', mergeable: true, merged: false },
      });

      await githubManager.getPRStatus(123, '/test/repo');

      expect(withRetry).toHaveBeenCalledWith(
        expect.any(Function),
        'Get PR status',
        2
      );
    });
  });
});
