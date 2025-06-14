import path from 'path';
import os from 'os';

// Application constants
export const APP_NAME = 'intern';
export const DEFAULT_PORT = 5050;

// Paths
export const INTERN_DIR = path.join(os.homedir(), '.intern');
export const DATABASE_PATH = path.join(INTERN_DIR, 'intern.db');
export const LOGS_DIR = path.join(INTERN_DIR, 'logs');

// Supported coding tools
export const CODING_TOOLS = ['amp', 'openai'] as const;
export type CodingTool = typeof CODING_TOOLS[number];

// Default settings
export const DEFAULT_SETTINGS = {
  branchPrefix: 'intern/',
  prTitlePrefix: '[INTERN]',
  commitSuffix: ' [i]',
  maxRetries: 3,
  baseBranch: 'main',
  pollInterval: 30,
  taskCheckInterval: 60,
  reviewCheckInterval: 30,
} as const;

// Git settings
export const GIT_CONFIG = {
  timeout: 300000, // 5 minutes
  maxRetries: 3,
} as const;

// API settings
export const API_CONFIG = {
  timeout: 300000, // 5 minutes
  maxRetries: 3,
} as const;

// Log levels
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = typeof LOG_LEVELS[number];
