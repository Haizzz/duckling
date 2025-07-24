import path from 'path';
import os from 'os';
import { DEFAULT_CODING_PROMPT } from '../core/prompts';

// Application constants
export const APP_NAME = 'duckling';
export const DEFAULT_PORT = 5050;

// Paths
export const DUCKLING_DIR = path.join(os.homedir(), '.duckling');
export const DATABASE_PATH = path.join(DUCKLING_DIR, 'duckling.db');
export const LOGS_DIR = path.join(DUCKLING_DIR, 'logs');

// Supported coding tools
export const CODING_TOOLS = ['amp', 'openai', 'claude'] as const;
export type CodingTool = (typeof CODING_TOOLS)[number];

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
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
