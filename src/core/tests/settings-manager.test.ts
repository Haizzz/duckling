import { SettingsManager } from '../settings-manager';
import { createMockInstance } from '../../utils/test-utils';
import { DatabaseManager } from '../database';

describe('SettingsManager', () => {
  let settingsManager: SettingsManager;
  let mockDb: jest.Mocked<DatabaseManager>;

  beforeEach(() => {
    mockDb = createMockInstance(DatabaseManager);
    settingsManager = new SettingsManager(mockDb);
  });

  describe('get', () => {
    it('calls getSetting with key and returns value from database', () => {
      mockDb.getSetting.mockReturnValue({
        key: 'githubToken',
        value: 'test-value',
        updated_at: '2023-01-01T10:00:00Z',
      });

      const result = settingsManager.get('githubToken');

      expect(mockDb.getSetting).toHaveBeenCalledWith('githubToken');
      expect(result).toBe('test-value');
    });

    it('returns default value when setting not found in database', () => {
      mockDb.getSetting.mockReturnValue(null);

      const result = settingsManager.get('maxRetries');

      expect(mockDb.getSetting).toHaveBeenCalledWith('maxRetries');
      expect(result).toBe(3); // Default value
    });

    it('converts string numbers to numbers for numeric keys', () => {
      mockDb.getSetting.mockReturnValue({
        key: 'maxRetries',
        value: '5',
        updated_at: '2023-01-01T10:00:00Z',
      });

      const result = settingsManager.get('maxRetries');

      expect(mockDb.getSetting).toHaveBeenCalledWith('maxRetries');
      expect(result).toBe(5);
      expect(typeof result).toBe('number');
    });
  });

  describe('set', () => {
    it('calls setSetting with key, value and default general category', () => {
      settingsManager.set('branchPrefix', 'feature-');

      expect(mockDb.setSetting).toHaveBeenCalledWith(
        'branchPrefix',
        'feature-'
      );
    });

    it('converts numbers to strings when calling setSetting', () => {
      settingsManager.set('maxRetries', 3);

      expect(mockDb.setSetting).toHaveBeenCalledWith('maxRetries', '3');
    });

    it('calls setSetting with custom category when provided', () => {
      settingsManager.set('githubToken', 'token123');

      expect(mockDb.setSetting).toHaveBeenCalledWith('githubToken', 'token123');
    });
  });

  describe('getAll', () => {
    it('returns all settings with proper type conversion from database', () => {
      // Mock database responses for different settings
      mockDb.getSetting.mockImplementation((key: string) => {
        const settings: Record<
          string,
          { key: string; value: string; updated_at: string } | null
        > = {
          githubUsername: {
            key: 'githubUsername',
            value: 'testuser',
            updated_at: '2023-01-01T10:00:00Z',
          },
          githubToken: {
            key: 'githubToken',
            value: 'token123',
            updated_at: '2023-01-01T10:00:00Z',
          },
          repositoryUrl: {
            key: 'repositoryUrl',
            value: 'https://github.com/test/repo',
            updated_at: '2023-01-01T10:00:00Z',
          },
          defaultCodingTool: {
            key: 'defaultCodingTool',
            value: 'amp',
            updated_at: '2023-01-01T10:00:00Z',
          },
          branchPrefix: {
            key: 'branchPrefix',
            value: 'feature-',
            updated_at: '2023-01-01T10:00:00Z',
          },
          baseBranch: {
            key: 'baseBranch',
            value: 'main',
            updated_at: '2023-01-01T10:00:00Z',
          },
          prTitlePrefix: {
            key: 'prTitlePrefix',
            value: '[DUCKLING]',
            updated_at: '2023-01-01T10:00:00Z',
          },
          commitSuffix: {
            key: 'commitSuffix',
            value: ' [quack]',
            updated_at: '2023-01-01T10:00:00Z',
          },
          maxRetries: {
            key: 'maxRetries',
            value: '5',
            updated_at: '2023-01-01T10:00:00Z',
          },
          ampApiKey: null,
          openaiApiKey: null,
          claudeApiKey: null,
          autoMerge: null,
          pollInterval: null,
        };
        return settings[key] || null;
      });

      const result = settingsManager.getAll();

      expect(result.githubToken).toBe('token123');
      expect(result.maxRetries).toBe(5);
      expect(result.branchPrefix).toBe('feature-');
      expect(result.ampApiKey).toBe(''); // default value
      expect(typeof result.maxRetries).toBe('number');
    });
  });
});
