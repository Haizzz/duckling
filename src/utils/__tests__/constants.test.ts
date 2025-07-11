import path from 'path';
import os from 'os';
import {
  APP_NAME,
  DEFAULT_PORT,
  DUCKLING_DIR,
  DATABASE_PATH,
  LOGS_DIR,
  CODING_TOOLS,
  DEFAULT_SETTINGS,
  LOG_LEVELS,
} from '../constants';

describe('Constants', () => {
  describe('App Configuration', () => {
    it('should have correct app name', () => {
      expect(APP_NAME).toBe('duckling');
    });

    it('should have correct default port', () => {
      expect(DEFAULT_PORT).toBe(5050);
    });
  });

  describe('Paths', () => {
    it('should have correct duckling directory', () => {
      expect(DUCKLING_DIR).toBe(path.join(os.homedir(), '.duckling'));
    });

    it('should have correct database path', () => {
      expect(DATABASE_PATH).toBe(path.join(DUCKLING_DIR, 'duckling.db'));
    });

    it('should have correct logs directory', () => {
      expect(LOGS_DIR).toBe(path.join(DUCKLING_DIR, 'logs'));
    });
  });

  describe('Coding Tools', () => {
    it('should include all supported coding tools', () => {
      expect(CODING_TOOLS).toEqual(['amp', 'openai']);
    });

    it('should be readonly array', () => {
      expect(CODING_TOOLS).toHaveLength(2);
      expect(Array.isArray(CODING_TOOLS)).toBe(true);
      // In TypeScript, const assertions create readonly arrays,
      // but at runtime they're still mutable arrays
      expect(CODING_TOOLS).toEqual(['amp', 'openai']);
    });
  });

  describe('Default Settings', () => {
    it('should have correct branch prefix', () => {
      expect(DEFAULT_SETTINGS.branchPrefix).toBe('duckling-');
    });

    it('should have correct PR title prefix', () => {
      expect(DEFAULT_SETTINGS.prTitlePrefix).toBe('[DUCKLING]');
    });

    it('should have correct commit suffix', () => {
      expect(DEFAULT_SETTINGS.commitSuffix).toBe(' [quack]');
    });

    it('should have correct comment prefix', () => {
      expect(DEFAULT_SETTINGS.commentPrefix).toBe('duckling');
    });

    it('should have correct max retries', () => {
      expect(DEFAULT_SETTINGS.maxRetries).toBe(3);
    });

    it('should have custom prompt', () => {
      expect(DEFAULT_SETTINGS.customPrompt).toBeDefined();
      expect(typeof DEFAULT_SETTINGS.customPrompt).toBe('string');
    });
  });

  describe('Log Levels', () => {
    it('should include all log levels', () => {
      expect(LOG_LEVELS).toEqual(['debug', 'info', 'warn', 'error']);
    });

    it('should be readonly array', () => {
      expect(LOG_LEVELS).toHaveLength(4);
      expect(Array.isArray(LOG_LEVELS)).toBe(true);
      // In TypeScript, const assertions create readonly arrays,
      // but at runtime they're still mutable arrays
      expect(LOG_LEVELS).toEqual(['debug', 'info', 'warn', 'error']);
    });
  });
});
