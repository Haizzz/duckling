import { SettingsManager } from '../settings-manager';
import { DatabaseManager } from '../database';
import { DEFAULT_CODING_PROMPT } from '../prompts';

jest.mock('../database');

const mockDatabaseManager = {
  getSetting: jest.fn(),
  setSetting: jest.fn(),
} as unknown as jest.Mocked<DatabaseManager>;

describe('SettingsManager', () => {
  let settingsManager: SettingsManager;

  beforeEach(() => {
    jest.clearAllMocks();
    settingsManager = new SettingsManager(mockDatabaseManager);
  });

  describe('get', () => {
    it('should return setting value from database', () => {
      mockDatabaseManager.getSetting.mockReturnValue({
        key: 'branchPrefix',
        value: 'feature-',
        updated_at: '2023-01-01T00:00:00Z',
      });

      const result = settingsManager.get('branchPrefix');

      expect(result).toBe('feature-');
      expect(mockDatabaseManager.getSetting).toHaveBeenCalledWith('branchPrefix');
    });

    it('should return default value when setting not found', () => {
      mockDatabaseManager.getSetting.mockReturnValue(null);

      const result = settingsManager.get('branchPrefix');

      expect(result).toBe('duckling-');
      expect(mockDatabaseManager.getSetting).toHaveBeenCalledWith('branchPrefix');
    });

    it('should return default value when setting value is undefined', () => {
      mockDatabaseManager.getSetting.mockReturnValue({
        key: 'branchPrefix',
        value: undefined as any,
        updated_at: '2023-01-01T00:00:00Z',
      });

      const result = settingsManager.get('branchPrefix');

      expect(result).toBe('duckling-');
    });

    it('should convert string to number for numeric settings', () => {
      mockDatabaseManager.getSetting.mockReturnValue({
        key: 'maxRetries',
        value: '5',
        updated_at: '2023-01-01T00:00:00Z',
      });

      const result = settingsManager.get('maxRetries');

      expect(result).toBe(5);
      expect(typeof result).toBe('number');
    });

    it('should handle all setting types', () => {
      // Test string setting
      mockDatabaseManager.getSetting.mockReturnValue({
        key: 'defaultCodingTool',
        value: 'openai',
        updated_at: '2023-01-01T00:00:00Z',
      });

      const codingTool = settingsManager.get('defaultCodingTool');
      expect(codingTool).toBe('openai');

      // Test number setting
      mockDatabaseManager.getSetting.mockReturnValue({
        key: 'maxRetries',
        value: '10',
        updated_at: '2023-01-01T00:00:00Z',
      });

      const maxRetries = settingsManager.get('maxRetries');
      expect(maxRetries).toBe(10);
    });
  });

  describe('set', () => {
    it('should set string setting', () => {
      settingsManager.set('branchPrefix', 'feature-');

      expect(mockDatabaseManager.setSetting).toHaveBeenCalledWith('branchPrefix', 'feature-');
    });

    it('should set number setting', () => {
      settingsManager.set('maxRetries', 5);

      expect(mockDatabaseManager.setSetting).toHaveBeenCalledWith('maxRetries', '5');
    });

    it('should set coding tool setting', () => {
      settingsManager.set('defaultCodingTool', 'openai');

      expect(mockDatabaseManager.setSetting).toHaveBeenCalledWith('defaultCodingTool', 'openai');
    });

    it('should handle empty string', () => {
      settingsManager.set('openaiApiKey', '');

      expect(mockDatabaseManager.setSetting).toHaveBeenCalledWith('openaiApiKey', '');
    });
  });

  describe('getAll', () => {
    it('should return all settings with defaults', () => {
      mockDatabaseManager.getSetting.mockReturnValue(null);

      const result = settingsManager.getAll();

      expect(result).toEqual({
        defaultCodingTool: 'amp',
        branchPrefix: 'duckling-',
        prTitlePrefix: '[DUCKLING]',
        commitSuffix: ' [quack]',
        commentPrefix: 'duckling',
        maxRetries: 3,
        openaiApiKey: '',
        customPrompt: DEFAULT_CODING_PROMPT,
      });
    });

    it('should return all settings with custom values', () => {
      mockDatabaseManager.getSetting.mockImplementation((key) => {
        const settings: Record<string, any> = {
          defaultCodingTool: { value: 'openai' },
          branchPrefix: { value: 'feature-' },
          prTitlePrefix: { value: '[FEATURE]' },
          commitSuffix: { value: ' [done]' },
          commentPrefix: { value: 'bot' },
          maxRetries: { value: '5' },
          openaiApiKey: { value: 'sk-test' },
          customPrompt: { value: 'Custom prompt' },
        };
        return settings[key] || null;
      });

      const result = settingsManager.getAll();

      expect(result).toEqual({
        defaultCodingTool: 'openai',
        branchPrefix: 'feature-',
        prTitlePrefix: '[FEATURE]',
        commitSuffix: ' [done]',
        commentPrefix: 'bot',
        maxRetries: 5,
        openaiApiKey: 'sk-test',
        customPrompt: 'Custom prompt',
      });
    });

    it('should mix default and custom values', () => {
      mockDatabaseManager.getSetting.mockImplementation((key) => {
        const settings: Record<string, any> = {
          branchPrefix: { value: 'feature-' },
          maxRetries: { value: '5' },
        };
        return settings[key] || null;
      });

      const result = settingsManager.getAll();

      expect(result.branchPrefix).toBe('feature-');
      expect(result.maxRetries).toBe(5);
      expect(result.defaultCodingTool).toBe('amp'); // default
      expect(result.prTitlePrefix).toBe('[DUCKLING]'); // default
    });
  });

  describe('getDefaults', () => {
    it('should return default settings', () => {
      const defaults = SettingsManager.getDefaults();

      expect(defaults).toEqual({
        defaultCodingTool: 'amp',
        branchPrefix: 'duckling-',
        prTitlePrefix: '[DUCKLING]',
        commitSuffix: ' [quack]',
        commentPrefix: 'duckling',
        maxRetries: 3,
        openaiApiKey: '',
        customPrompt: DEFAULT_CODING_PROMPT,
      });
    });

    it('should return a copy of defaults', () => {
      const defaults1 = SettingsManager.getDefaults();
      const defaults2 = SettingsManager.getDefaults();

      expect(defaults1).not.toBe(defaults2);
      expect(defaults1).toEqual(defaults2);
    });
  });

  describe('Type Safety', () => {
    it('should enforce correct types', () => {
      // These should compile without TypeScript errors
      settingsManager.set('defaultCodingTool', 'amp');
      settingsManager.set('defaultCodingTool', 'openai');
      settingsManager.set('branchPrefix', 'feature-');
      settingsManager.set('maxRetries', 5);

      const codingTool = settingsManager.get('defaultCodingTool');
      const branchPrefix = settingsManager.get('branchPrefix');
      const maxRetries = settingsManager.get('maxRetries');

      expect(typeof codingTool).toBe('string');
      expect(typeof branchPrefix).toBe('string');
      expect(typeof maxRetries).toBe('number');
    });
  });
});
