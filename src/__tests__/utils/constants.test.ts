import {
  APP_NAME,
  DEFAULT_PORT,
  DUCKLING_DIR,
  DATABASE_PATH,
  LOGS_DIR,
  CODING_TOOLS,
  DEFAULT_SETTINGS,
  LOG_LEVELS,
} from '../../utils/constants';
import path from 'path';
import os from 'os';

describe('Constants', () => {
  describe('App constants', () => {
    it('should have correct app name', () => {
      expect(APP_NAME).toBe('duckling');
    });

    it('should have correct default port', () => {
      expect(DEFAULT_PORT).toBe(5050);
    });
  });

  describe('Path constants', () => {
    it('should have correct duckling directory', () => {
      expect(DUCKLING_DIR).toBe(path.join(os.homedir(), '.duckling'));
    });

    it('should have correct database path', () => {
      expect(DATABASE_PATH).toBe(
        path.join(os.homedir(), '.duckling', 'duckling.db')
      );
    });

    it('should have correct logs directory', () => {
      expect(LOGS_DIR).toBe(path.join(os.homedir(), '.duckling', 'logs'));
    });
  });

  describe('Coding tools', () => {
    it('should have correct coding tools', () => {
      expect(CODING_TOOLS).toEqual(['amp', 'openai']);
    });

    it('should be readonly array', () => {
      expect(Array.isArray(CODING_TOOLS)).toBe(true);
    });
  });

  describe('Default settings', () => {
    it('should have correct default settings', () => {
      expect(DEFAULT_SETTINGS.branchPrefix).toBe('duckling-');
      expect(DEFAULT_SETTINGS.prTitlePrefix).toBe('[DUCKLING]');
      expect(DEFAULT_SETTINGS.commitSuffix).toBe(' [quack]');
      expect(DEFAULT_SETTINGS.commentPrefix).toBe('duckling');
      expect(DEFAULT_SETTINGS.maxRetries).toBe(3);
    });

    it('should be readonly object', () => {
      expect(typeof DEFAULT_SETTINGS).toBe('object');
    });
  });

  describe('Log levels', () => {
    it('should have correct log levels', () => {
      expect(LOG_LEVELS).toEqual(['debug', 'info', 'warn', 'error']);
    });

    it('should be readonly array', () => {
      expect(Array.isArray(LOG_LEVELS)).toBe(true);
    });
  });
});
