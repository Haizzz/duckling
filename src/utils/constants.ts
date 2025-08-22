import path from 'path';
import os from 'os';
import { DEFAULT_CODING_PROMPT } from '../core/prompts';

// Application constants

// Paths
export const DUCKLING_DIR = path.join(os.homedir(), '.duckling');
export const DATABASE_PATH = path.join(DUCKLING_DIR, 'duckling.db');
export const LOGS_DIR = path.join(DUCKLING_DIR, 'logs');

// Supported coding tools

// Default settings
export const DEFAULT_SETTINGS = {
  branchPrefix: 'duckling-',
  prTitlePrefix: '[DUCKLING]',
  commitSuffix: ' [quack]',
  commentPrefix: 'duckling',
  maxRetries: 3,
  customPrompt: DEFAULT_CODING_PROMPT,
} as const;

// Log levels
