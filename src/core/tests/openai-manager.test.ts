jest.mock('openai');
jest.mock('../../utils/retry');

import OpenAI from 'openai';
import { OpenAIManager } from '../openai-manager';
import { withRetry } from '../../utils/retry';
import { DatabaseManager } from '../database';
import { createMockInstance } from '../../utils/test-utils';

describe('OpenAIManager', () => {
  let openaiManager: OpenAIManager;
  let mockDb: jest.Mocked<DatabaseManager>;
  let mockOpenAIInstance: {
    chat: {
      completions: {
        create: jest.Mock;
      };
    };
  };

  beforeEach(() => {
    mockDb = createMockInstance(DatabaseManager);

    mockOpenAIInstance = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    };

    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(
      () => mockOpenAIInstance as any
    );

    (withRetry as jest.Mock).mockImplementation(async (fn) => await fn());

    // Set default API key to ensure OpenAI is initialized unless explicitly overridden
    mockDb.getSetting.mockReturnValue({
      key: 'openaiApiKey',
      value: 'default-test-key',
      updated_at: new Date().toISOString(),
    });

    openaiManager = new OpenAIManager(mockDb);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor and initialization', () => {
    it('initializes with database and settings manager', () => {
      expect(openaiManager).toBeInstanceOf(OpenAIManager);
    });

    it('initializes OpenAI client when API key is available', () => {
      mockDb.getSetting.mockReturnValue({
        key: 'openaiApiKey',
        value: 'test-api-key',
        updated_at: new Date().toISOString(),
      });

      new OpenAIManager(mockDb);

      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
      });
    });

    it('does not initialize OpenAI client when API key is not available', () => {
      // Clear the mock call count from the main beforeEach
      (OpenAI as jest.MockedClass<typeof OpenAI>).mockClear();

      const mockDbLocal = createMockInstance(DatabaseManager);
      mockDbLocal.getSetting.mockReturnValue(null);

      new OpenAIManager(mockDbLocal);

      expect(OpenAI).not.toHaveBeenCalled();
    });
  });

  describe('generateBranchName', () => {
    beforeEach(() => {
      mockDb.getSetting.mockImplementation((key: string) => {
        if (key === 'openaiApiKey')
          return {
            key: 'openaiApiKey',
            value: 'test-api-key',
            updated_at: new Date().toISOString(),
          };
        if (key === 'branchPrefix')
          return {
            key: 'branchPrefix',
            value: 'duckling-',
            updated_at: new Date().toISOString(),
          };
        return null;
      });
      openaiManager.refreshClient(); // Refresh to pick up new settings
    });

    it('generates branch name using OpenAI API when available', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'fix-user-authentication',
            },
          },
        ],
      });

      const result = await openaiManager.generateBranchName(
        'Fix user authentication bug',
        123
      );

      expect(result).toBe('fix-user-authenticati'); // Truncated to 20 chars (30 - 'duckling-'.length)
      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: expect.stringContaining('Fix user authentication bug'),
          },
        ],
      });
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message: '🤖 Analyzing task description to generate branch name...',
      });
    });

    it('cleans up generated branch name to ensure validity', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Fix User Authentication Bug!!!',
            },
          },
        ],
      });

      const result = await openaiManager.generateBranchName(
        'Fix user authentication bug',
        123
      );

      expect(result).toBe('fix-user-authenticati'); // Cleaned and truncated to 20 chars
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message: expect.stringContaining('Generated AI branch name'),
      });
    });

    it('respects maximum branch name length based on prefix', async () => {
      mockDb.getSetting.mockImplementation((key: string) => {
        if (key === 'openaiApiKey')
          return {
            key: 'openaiApiKey',
            value: 'test-api-key',
            updated_at: new Date().toISOString(),
          };
        if (key === 'branchPrefix')
          return {
            key: 'branchPrefix',
            value: 'very-long-prefix-',
            updated_at: new Date().toISOString(),
          };
        return null;
      });

      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'this-is-a-very-long-branch-name-that-exceeds-the-limit',
            },
          },
        ],
      });

      const result = await openaiManager.generateBranchName(
        'Long task description',
        123
      );

      expect(result.length).toBeLessThanOrEqual(
        30 - 'very-long-prefix-'.length
      );
    });

    it('falls back to simple generation when OpenAI API fails', async () => {
      mockOpenAIInstance.chat.completions.create.mockRejectedValue(
        new Error('API Error')
      );

      const result = await openaiManager.generateBranchName(
        'Fix user authentication bug',
        123
      );

      expect(result).toBe('fix-user-authenticati'); // Simple fallback generation, truncated to 20 chars
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'warn',
        message: expect.stringContaining('AI branch name generation failed'),
      });
    });

    it('falls back to simple generation when OpenAI not configured', async () => {
      const mockDbLocal = createMockInstance(DatabaseManager);
      mockDbLocal.getSetting.mockImplementation((key: string) => {
        if (key === 'openaiApiKey') return null;
        if (key === 'branchPrefix')
          return {
            key: 'branchPrefix',
            value: 'duckling-',
            updated_at: new Date().toISOString(),
          };
        return null;
      });

      const unconfiguredManager = new OpenAIManager(mockDbLocal);
      const result = await unconfiguredManager.generateBranchName(
        'Fix user authentication bug',
        123
      );

      expect(result).toBe('fix-user-authenticati'); // Simple fallback generation, truncated to 20 chars
      expect(mockDbLocal.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message:
          '⚠️ OpenAI not configured, using simple branch name generation',
      });
    });

    it('handles empty response from OpenAI API', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: '',
            },
          },
        ],
      });

      const result = await openaiManager.generateBranchName('Fix bug', 123);

      expect(result).toBe('fix-bug'); // fallback to simple generation
    });

    it('works without task ID for logging', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'fix-authentication',
            },
          },
        ],
      });

      const result =
        await openaiManager.generateBranchName('Fix authentication');

      expect(result).toBe('fix-authentication');
      expect(mockDb.addTaskLog).not.toHaveBeenCalled();
    });
  });

  describe('generatePRTitle', () => {
    beforeEach(() => {
      mockDb.getSetting.mockImplementation((key: string) => {
        if (key === 'openaiApiKey')
          return {
            key: 'openaiApiKey',
            value: 'test-api-key',
            updated_at: new Date().toISOString(),
          };
        if (key === 'prTitlePrefix')
          return {
            key: 'prTitlePrefix',
            value: '[DUCKLING]',
            updated_at: new Date().toISOString(),
          };
        return null;
      });
      openaiManager.refreshClient(); // Refresh to pick up new settings
    });

    it('generates PR title using OpenAI API when available', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Fix authentication bug in login flow',
            },
          },
        ],
      });

      const result = await openaiManager.generatePRTitle(
        'Fix user authentication bug'
      );

      expect(result).toBe('[DUCKLING] Fix authentication bug in login flow');
      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: expect.stringContaining('Fix user authentication bug'),
          },
        ],
      });
    });

    it('cleans up generated title by removing quotes', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: '"Fix authentication bug in login flow"',
            },
          },
        ],
      });

      const result = await openaiManager.generatePRTitle(
        'Fix user authentication bug'
      );

      expect(result).toBe('[DUCKLING] Fix authentication bug in login flow');
    });

    it('falls back to simple generation when title exceeds length limit', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content:
                'This is a very long pull request title that exceeds the maximum allowed length of 100 characters',
            },
          },
        ],
      });

      const result = await openaiManager.generatePRTitle(
        'Fix user authentication bug'
      );

      expect(result).toMatch(/^\[DUCKLING\] Fix user authentication bug/);
      expect(result.length).toBeLessThanOrEqual(100);
    });

    it('falls back to simple generation when OpenAI API fails', async () => {
      mockOpenAIInstance.chat.completions.create.mockRejectedValue(
        new Error('API Error')
      );

      const result = await openaiManager.generatePRTitle(
        'Fix user authentication bug'
      );

      expect(result).toMatch(/^\[DUCKLING\] Fix user authentication bug/);
    });

    it('falls back to simple generation when OpenAI not configured', async () => {
      const mockDbLocal = createMockInstance(DatabaseManager);
      mockDbLocal.getSetting.mockImplementation((key: string) => {
        if (key === 'openaiApiKey') return null;
        if (key === 'prTitlePrefix')
          return {
            key: 'prTitlePrefix',
            value: '[DUCKLING]',
            updated_at: new Date().toISOString(),
          };
        return null;
      });

      const unconfiguredManager = new OpenAIManager(mockDbLocal);
      const result = await unconfiguredManager.generatePRTitle(
        'Fix user authentication bug'
      );

      expect(result).toBe('[DUCKLING] Fix user authentication bug'); // No ... because it's exactly 50 chars after prefix
    });
  });

  describe('generatePRDescription', () => {
    beforeEach(() => {
      mockDb.getSetting.mockImplementation((key: string) => {
        if (key === 'openaiApiKey')
          return {
            key: 'openaiApiKey',
            value: 'test-api-key',
            updated_at: new Date().toISOString(),
          };
        return null;
      });
      openaiManager.refreshClient(); // Refresh to pick up new settings
    });

    it('generates PR description using OpenAI API when available', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content:
                'This PR fixes the authentication bug by updating the login validation logic.',
            },
          },
        ],
      });

      const result = await openaiManager.generatePRDescription(
        'Fix user authentication bug',
        'fix-auth-bug'
      );

      expect(result).toBe(
        'This PR fixes the authentication bug by updating the login validation logic.'
      );
      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: expect.stringContaining('Fix user authentication bug'),
          },
        ],
      });
    });

    it('falls back to simple generation when OpenAI API fails', async () => {
      mockOpenAIInstance.chat.completions.create.mockRejectedValue(
        new Error('API Error')
      );

      const result = await openaiManager.generatePRDescription(
        'Fix user authentication bug',
        'fix-auth-bug'
      );

      expect(result).toContain('Fix user authentication bug');
      expect(result).toContain('fix-auth-bug');
    });

    it('falls back to simple generation when OpenAI not configured', async () => {
      mockDb.getSetting.mockImplementation((key: string) => {
        if (key === 'openaiApiKey') return null;
        return null;
      });

      const result = await openaiManager.generatePRDescription(
        'Fix user authentication bug',
        'fix-auth-bug'
      );

      expect(result).toContain('Fix user authentication bug');
      expect(result).toContain('fix-auth-bug');
    });
  });

  describe('generateTaskSummary', () => {
    beforeEach(() => {
      mockDb.getSetting.mockImplementation((key: string) => {
        if (key === 'openaiApiKey')
          return {
            key: 'openaiApiKey',
            value: 'test-api-key',
            updated_at: new Date().toISOString(),
          };
        return null;
      });
      openaiManager.refreshClient(); // Refresh to pick up new settings
    });

    it('generates task summary using OpenAI API when available', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Fix user authentication bug in login flow',
            },
          },
        ],
      });

      const result = await openaiManager.generateTaskSummary(
        'Fix the user authentication bug that occurs when users try to log in with invalid credentials'
      );

      expect(result).toBe('Fix user authentication bug in login flow');
      expect(result.length).toBeLessThanOrEqual(80);
    });

    it('falls back to simple generation when summary exceeds length limit', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content:
                'This is a very long task summary that exceeds the maximum allowed length of 80 characters',
            },
          },
        ],
      });

      const taskDescription = 'Fix user authentication bug';
      const result = await openaiManager.generateTaskSummary(taskDescription);

      expect(result).toBe(taskDescription);
    });

    it('falls back to simple generation when OpenAI not configured', async () => {
      const mockDbLocal = createMockInstance(DatabaseManager);
      mockDbLocal.getSetting.mockImplementation((key: string) => {
        if (key === 'openaiApiKey') return null;
        return null;
      });

      const unconfiguredManager = new OpenAIManager(mockDbLocal);
      const taskDescription =
        'Fix the user authentication bug that occurs when users try to log in with invalid credentials and it shows error';
      const result =
        await unconfiguredManager.generateTaskSummary(taskDescription);

      expect(result).toBe(
        'Fix the user authentication bug that occurs when users try to log in with invali...'
      ); // Truncated at 80 chars + '...'
      expect(result.length).toBe(83); // 80 chars + 3 dots
    });
  });

  describe('generateCommitMessage', () => {
    beforeEach(() => {
      mockDb.getSetting.mockImplementation((key: string) => {
        if (key === 'openaiApiKey')
          return {
            key: 'openaiApiKey',
            value: 'test-api-key',
            updated_at: new Date().toISOString(),
          };
        return null;
      });
      openaiManager.refreshClient(); // Refresh to pick up new settings
    });

    it('generates commit message using OpenAI API when available', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Fix authentication validation',
            },
          },
        ],
      });

      const result = await openaiManager.generateCommitMessage(
        'Fix user authentication bug',
        ['auth.ts', 'login.ts'],
        123
      );

      expect(result).toBe('Fix authentication validation');
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message: '🤖 Analyzing 2 changed files to generate commit message...',
      });
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message:
          '✅ Generated AI commit message: "Fix authentication validation"',
      });
    });

    it('includes changed files in the prompt when provided', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Update user authentication',
            },
          },
        ],
      });

      await openaiManager.generateCommitMessage(
        'Update authentication',
        ['auth.ts', 'user.ts', 'login.ts'],
        123
      );

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: expect.stringContaining(
              'Files changed: auth.ts, user.ts, login.ts'
            ),
          },
        ],
      });
    });

    it('limits changed files to first 5 in the prompt', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Update multiple files',
            },
          },
        ],
      });

      const manyFiles = [
        'file1.ts',
        'file2.ts',
        'file3.ts',
        'file4.ts',
        'file5.ts',
        'file6.ts',
        'file7.ts',
      ];
      await openaiManager.generateCommitMessage('Update files', manyFiles, 123);

      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: expect.stringContaining(
              'Files changed: file1.ts, file2.ts, file3.ts, file4.ts, file5.ts'
            ),
          },
        ],
      });
    });

    it('cleans up generated commit message by removing quotes and periods', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: '"Fix authentication validation."',
            },
          },
        ],
      });

      const result = await openaiManager.generateCommitMessage(
        'Fix auth bug',
        [],
        123
      );

      expect(result).toBe('Fix authentication validation');
    });

    it('falls back to simple generation when message exceeds length limit', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content:
                'This is a very long commit message that exceeds the limit',
            },
          },
        ],
      });

      const result = await openaiManager.generateCommitMessage(
        'Fix user authentication bug',
        [],
        123
      );

      expect(result).toBe('Fix user authentication bug');
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message:
          '📝 Using fallback commit message: "Fix user authentication bug"',
      });
    });

    it('falls back to simple generation when OpenAI API fails', async () => {
      mockOpenAIInstance.chat.completions.create.mockRejectedValue(
        new Error('API Error')
      );

      const result = await openaiManager.generateCommitMessage(
        'Fix user authentication bug',
        [],
        123
      );

      expect(result).toBe('Fix user authentication bug');
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'warn',
        message: expect.stringContaining('AI commit message generation failed'),
      });
    });

    it('falls back to simple generation when OpenAI not configured', async () => {
      const mockDbLocal = createMockInstance(DatabaseManager);
      mockDbLocal.getSetting.mockImplementation((key: string) => {
        if (key === 'openaiApiKey') return null;
        return null;
      });

      const unconfiguredManager = new OpenAIManager(mockDbLocal);
      const result = await unconfiguredManager.generateCommitMessage(
        'Fix user authentication bug',
        [],
        123
      );

      expect(result).toBe('Fix user authentication bug');
      expect(mockDbLocal.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message:
          '⚠️ OpenAI not configured, using simple commit message generation',
      });
    });

    it('works without task ID for logging', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Fix authentication',
            },
          },
        ],
      });

      const result = await openaiManager.generateCommitMessage('Fix auth', []);

      expect(result).toBe('Fix authentication');
      expect(mockDb.addTaskLog).not.toHaveBeenCalled();
    });
  });

  describe('refreshClient', () => {
    it('reinitializes OpenAI client when called', () => {
      const getSpy = jest.spyOn(mockDb, 'getSetting').mockReturnValue({
        key: 'openaiApiKey',
        value: 'new-api-key',
        updated_at: new Date().toISOString(),
      });

      openaiManager.refreshClient();

      expect(getSpy).toHaveBeenCalledWith('openaiApiKey');
      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: 'new-api-key',
      });
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      mockDb.getSetting.mockReturnValue({
        key: 'openaiApiKey',
        value: 'test-api-key',
        updated_at: new Date().toISOString(),
      });
    });

    it('throws error when OpenAI returns no content', async () => {
      mockOpenAIInstance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: null,
            },
          },
        ],
      });

      (withRetry as jest.Mock).mockImplementation(async (fn) => {
        await expect(fn()).rejects.toThrow('No response from OpenAI');
        throw new Error('No response from OpenAI');
      });

      await expect(
        openaiManager.generateBranchName('test task', 123)
      ).resolves.toBe('test-task');
    });

    it('throws error when OpenAI client not initialized', async () => {
      mockDb.getSetting.mockReturnValue(null);
      const uninitializedManager = new OpenAIManager(mockDb);

      await expect(
        uninitializedManager.generateBranchName('test')
      ).resolves.toBe('test');
    });

    it('handles OpenAI API errors gracefully', async () => {
      mockOpenAIInstance.chat.completions.create.mockRejectedValue(
        new Error('Rate limit exceeded')
      );

      const result = await openaiManager.generateBranchName('Fix bug', 123);

      expect(result).toBe('fix-bug'); // fallback
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'warn',
        message: expect.stringContaining('AI branch name generation failed'),
      });
    });
  });
});
