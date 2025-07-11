import { OpenAIManager } from '../openai-manager';
import { OpenAI } from 'openai';

jest.mock('openai');

const mockOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;

describe('OpenAIManager', () => {
  let openaiManager: OpenAIManager;
  let mockChatCompletions: jest.Mocked<OpenAI['chat']['completions']>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockChatCompletions = {
      create: jest.fn(),
    } as any;

    mockOpenAI.mockImplementation(() => ({
      chat: {
        completions: mockChatCompletions,
      },
    } as any));

    openaiManager = new OpenAIManager('test-api-key');
  });

  describe('Constructor', () => {
    it('should initialize with API key', () => {
      expect(mockOpenAI).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
      });
    });

    it('should throw error with empty API key', () => {
      expect(() => new OpenAIManager('')).toThrow('OpenAI API key is required');
    });

    it('should throw error with undefined API key', () => {
      expect(() => new OpenAIManager(undefined as any)).toThrow('OpenAI API key is required');
    });
  });

  describe('generateText', () => {
    it('should generate text from prompt', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Generated response',
            },
          },
        ],
      };

      mockChatCompletions.create.mockResolvedValue(mockResponse as any);

      const result = await openaiManager.generateText('Test prompt');

      expect(result).toBe('Generated response');
      expect(mockChatCompletions.create).toHaveBeenCalledWith({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'user',
            content: 'Test prompt',
          },
        ],
        max_tokens: 150,
        temperature: 0.7,
      });
    });

    it('should handle empty response', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: null,
            },
          },
        ],
      };

      mockChatCompletions.create.mockResolvedValue(mockResponse as any);

      const result = await openaiManager.generateText('Test prompt');

      expect(result).toBe('');
    });

    it('should handle no choices in response', async () => {
      const mockResponse = {
        choices: [],
      };

      mockChatCompletions.create.mockResolvedValue(mockResponse as any);

      const result = await openaiManager.generateText('Test prompt');

      expect(result).toBe('');
    });

    it('should handle API errors', async () => {
      const error = new Error('API Error');
      mockChatCompletions.create.mockRejectedValue(error);

      await expect(openaiManager.generateText('Test prompt')).rejects.toThrow('API Error');
    });

    it('should use custom model when specified', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Generated response',
            },
          },
        ],
      };

      mockChatCompletions.create.mockResolvedValue(mockResponse as any);

      await openaiManager.generateText('Test prompt', 'gpt-4');

      expect(mockChatCompletions.create).toHaveBeenCalledWith({
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: 'Test prompt',
          },
        ],
        max_tokens: 150,
        temperature: 0.7,
      });
    });
  });

  describe('generateCommitMessage', () => {
    it('should generate commit message from changes', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'feat: add user authentication',
            },
          },
        ],
      };

      mockChatCompletions.create.mockResolvedValue(mockResponse as any);

      const result = await openaiManager.generateCommitMessage('Added auth module');

      expect(result).toBe('feat: add user authentication');
      expect(mockChatCompletions.create).toHaveBeenCalledWith({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'user',
            content: expect.stringContaining('Added auth module'),
          },
        ],
        max_tokens: 150,
        temperature: 0.7,
      });
    });

    it('should handle empty changes', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'chore: update files',
            },
          },
        ],
      };

      mockChatCompletions.create.mockResolvedValue(mockResponse as any);

      const result = await openaiManager.generateCommitMessage('');

      expect(result).toBe('chore: update files');
    });
  });

  describe('generateTaskSummary', () => {
    it('should generate task summary', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Successfully implemented user authentication with JWT tokens',
            },
          },
        ],
      };

      mockChatCompletions.create.mockResolvedValue(mockResponse as any);

      const result = await openaiManager.generateTaskSummary('Add user authentication');

      expect(result).toBe('Successfully implemented user authentication with JWT tokens');
      expect(mockChatCompletions.create).toHaveBeenCalledWith({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'user',
            content: expect.stringContaining('Add user authentication'),
          },
        ],
        max_tokens: 150,
        temperature: 0.7,
      });
    });

    it('should handle empty task', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Task completed successfully',
            },
          },
        ],
      };

      mockChatCompletions.create.mockResolvedValue(mockResponse as any);

      const result = await openaiManager.generateTaskSummary('');

      expect(result).toBe('Task completed successfully');
    });
  });
});
