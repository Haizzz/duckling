import { SettingsManager, SettingsDefaults } from '../../core/settings-manager';
import { DatabaseManager } from '../../core/database';

// Mock DatabaseManager
jest.mock('../../core/database');
const mockDatabaseManager = DatabaseManager as jest.MockedClass<
  typeof DatabaseManager
>;

describe('SettingsManager', () => {
  let mockDb: jest.Mocked<DatabaseManager>;
  let settingsManager: SettingsManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = new mockDatabaseManager() as jest.Mocked<DatabaseManager>;
    settingsManager = new SettingsManager(mockDb);
  });

  describe('get', () => {
    it('should return setting value from database', () => {
      mockDb.getSetting.mockReturnValue({
        key: 'branchPrefix',
        value: 'custom-prefix-',
        updated_at: '2023-01-01T12:00:00Z',
      });

      const result = settingsManager.get('branchPrefix');

      expect(result).toBe('custom-prefix-');
      expect(mockDb.getSetting).toHaveBeenCalledWith('branchPrefix');
    });

    it('should return default value when setting not found', () => {
      mockDb.getSetting.mockReturnValue(null);

      const result = settingsManager.get('branchPrefix');

      expect(result).toBe('duckling-');
      expect(mockDb.getSetting).toHaveBeenCalledWith('branchPrefix');
    });

    it('should handle number conversion', () => {
      mockDb.getSetting.mockReturnValue({
        key: 'maxRetries',
        value: '5',
        updated_at: '2023-01-01T12:00:00Z',
      });

      const result = settingsManager.get('maxRetries');

      expect(result).toBe(5);
      expect(typeof result).toBe('number');
    });

    it('should return default for string settings', () => {
      mockDb.getSetting.mockReturnValue(null);

      const result = settingsManager.get('defaultCodingTool');

      expect(result).toBe('amp');
    });

    it('should return default for number settings', () => {
      mockDb.getSetting.mockReturnValue(null);

      const result = settingsManager.get('maxRetries');

      expect(result).toBe(3);
      expect(typeof result).toBe('number');
    });

    it('should handle empty string setting', () => {
      mockDb.getSetting.mockReturnValue({
        key: 'openaiApiKey',
        value: '',
        updated_at: '2023-01-01T12:00:00Z',
      });

      const result = settingsManager.get('openaiApiKey');

      expect(result).toBe('');
    });
  });

  describe('set', () => {
    it('should set string setting', () => {
      settingsManager.set('branchPrefix', 'new-prefix-');

      expect(mockDb.setSetting).toHaveBeenCalledWith(
        'branchPrefix',
        'new-prefix-'
      );
    });

    it('should set number setting', () => {
      settingsManager.set('maxRetries', 10);

      expect(mockDb.setSetting).toHaveBeenCalledWith('maxRetries', '10');
    });

    it('should set coding tool setting', () => {
      settingsManager.set('defaultCodingTool', 'openai');

      expect(mockDb.setSetting).toHaveBeenCalledWith(
        'defaultCodingTool',
        'openai'
      );
    });

    it('should handle empty string', () => {
      settingsManager.set('openaiApiKey', '');

      expect(mockDb.setSetting).toHaveBeenCalledWith('openaiApiKey', '');
    });
  });

  describe('getAll', () => {
    it('should return all settings with database values', () => {
      mockDb.getSetting
        .mockReturnValueOnce({
          key: 'defaultCodingTool',
          value: 'openai',
          updated_at: '2023-01-01T12:00:00Z',
        })
        .mockReturnValueOnce({
          key: 'branchPrefix',
          value: 'custom-',
          updated_at: '2023-01-01T12:00:00Z',
        })
        .mockReturnValueOnce(null) // prTitlePrefix - use default
        .mockReturnValueOnce({
          key: 'commitSuffix',
          value: ' [custom]',
          updated_at: '2023-01-01T12:00:00Z',
        })
        .mockReturnValueOnce(null) // commentPrefix - use default
        .mockReturnValueOnce({
          key: 'maxRetries',
          value: '5',
          updated_at: '2023-01-01T12:00:00Z',
        })
        .mockReturnValueOnce({
          key: 'openaiApiKey',
          value: 'sk-test',
          updated_at: '2023-01-01T12:00:00Z',
        });

      const result = settingsManager.getAll();

      expect(result).toEqual({
        defaultCodingTool: 'openai',
        branchPrefix: 'custom-',
        prTitlePrefix: '[DUCKLING]', // default
        commitSuffix: ' [custom]',
        commentPrefix: 'duckling', // default
        maxRetries: 5,
        openaiApiKey: 'sk-test',
      });
    });

    it('should return all defaults when no settings exist', () => {
      mockDb.getSetting.mockReturnValue(null);

      const result = settingsManager.getAll();

      expect(result).toEqual({
        defaultCodingTool: 'amp',
        branchPrefix: 'duckling-',
        prTitlePrefix: '[DUCKLING]',
        commitSuffix: ' [quack]',
        commentPrefix: 'duckling',
        maxRetries: 3,
        openaiApiKey: '',
      });
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
      });
    });

    it('should return a new object each time', () => {
      const defaults1 = SettingsManager.getDefaults();
      const defaults2 = SettingsManager.getDefaults();

      expect(defaults1).not.toBe(defaults2);
      expect(defaults1).toEqual(defaults2);
    });
  });

  describe('setting value types', () => {
    it('should handle all supported setting types', () => {
      // Test each setting type
      const testCases: Array<[keyof SettingsDefaults, any]> = [
        ['defaultCodingTool', 'openai'],
        ['branchPrefix', 'test-'],
        ['prTitlePrefix', '[TEST]'],
        ['commitSuffix', ' [test]'],
        ['commentPrefix', 'test'],
        ['maxRetries', 5],
        ['openaiApiKey', 'sk-test-key'],
      ];

      testCases.forEach(([key, value]) => {
        settingsManager.set(key, value);
        expect(mockDb.setSetting).toHaveBeenCalledWith(key, String(value));
      });
    });
  });
});
