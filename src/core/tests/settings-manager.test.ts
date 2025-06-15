import { SettingsManager } from '../settings-manager';

describe('SettingsManager', () => {
  let settingsManager: SettingsManager;
  let mockDb: {
    getSetting: jest.Mock;
    setSetting: jest.Mock;
  };

  beforeEach(() => {
    mockDb = {
      getSetting: jest.fn(),
      setSetting: jest.fn(),
    };
    settingsManager = new SettingsManager(mockDb as any);
  });

  describe('get', () => {
    it('calls getSetting with key and returns value from database', () => {
      mockDb.getSetting.mockReturnValue({ value: 'test-value', category: 'github' });

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
      mockDb.getSetting.mockReturnValue({ value: '5', category: 'general' });

      const result = settingsManager.get('maxRetries');

      expect(mockDb.getSetting).toHaveBeenCalledWith('maxRetries');
      expect(result).toBe(5);
      expect(typeof result).toBe('number');
    });
  });

  describe('set', () => {
    it('calls setSetting with key, value and default general category', () => {
      settingsManager.set('branchPrefix', 'feature-');

      expect(mockDb.setSetting).toHaveBeenCalledWith('branchPrefix', 'feature-', 'general');
    });

    it('converts numbers to strings when calling setSetting', () => {
      settingsManager.set('maxRetries', 3);

      expect(mockDb.setSetting).toHaveBeenCalledWith('maxRetries', '3', 'general');
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
        const settings: Record<string, { value: string; category: string } | null> = {
          githubUsername: { value: 'testuser', category: 'github' },
          githubToken: { value: 'token123', category: 'github' },
          repositoryUrl: { value: 'https://github.com/test/repo', category: 'github' },
          defaultCodingTool: { value: 'amp', category: 'general' },
          branchPrefix: { value: 'feature-', category: 'general' },
          baseBranch: { value: 'main', category: 'general' },
          prTitlePrefix: { value: '[DUCKLING]', category: 'general' },
          commitSuffix: { value: ' [quack]', category: 'general' },
          maxRetries: { value: '5', category: 'general' },
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
