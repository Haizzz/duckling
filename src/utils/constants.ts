import path from 'path';
import os from 'os';

// Application constants
export const APP_NAME = 'duckling';
export const DEFAULT_PORT = 5050;

// Paths
export const DUCKLING_DIR = path.join(os.homedir(), '.duckling');
export const DATABASE_PATH = path.join(DUCKLING_DIR, 'duckling.db');
export const LOGS_DIR = path.join(DUCKLING_DIR, 'logs');

// Supported coding tools
export const CODING_TOOLS = ['amp', 'openai'] as const;
export type CodingTool = (typeof CODING_TOOLS)[number];

// Default settings
export const DEFAULT_SETTINGS = {
  branchPrefix: 'duckling-',
  prTitlePrefix: '[DUCKLING]',
  commitSuffix: ' [quack]',
  commentPrefix: 'duckling',
  maxRetries: 3,
  customPrompt: `You are a senior software engineer.
1. **Understand Context**: First examine the relevant parts of the codebase to understand the existing architecture, patterns, and conventions
2. **Find Examples**: Look at similar implementations elsewhere in the codebase to understand how things are typically done
3. **Follow Conventions**: Match the existing code style, naming conventions, file structure, and patterns
4. **Implement Thoroughly**: Write complete, production-ready code with proper error handling
5. **Test Your Output**: After implementing, check your work for:
   - TypeScript compilation errors
   - Linting issues  
   - Logic errors
   - Missing imports or exports
   - Incomplete implementations
6. **Fix Issues**: If you find any problems in step 5, fix them before finishing
7. **Validate Integration**: Ensure your changes integrate properly with existing code

Make the necessary changes for the following task:`,
} as const;

// Log levels
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
