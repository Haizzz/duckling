import { DatabaseManager } from './database';
import { CodingTool } from '../types';

export interface SettingsDefaults {
  repositoryUrl: string;
  defaultCodingTool: CodingTool;
  branchPrefix: string;
  prTitlePrefix: string;
  commitSuffix: string;
  commentPrefix: string;
  maxRetries: number;
  ampApiKey: string;
  openaiApiKey: string;
  customPrompt: string;
}

export class SettingsManager {
  private static readonly DEFAULTS: SettingsDefaults = {
    repositoryUrl: '',
    defaultCodingTool: 'amp',
    branchPrefix: 'duckling-',
    prTitlePrefix: '[DUCKLING]',
    commitSuffix: ' [quack]',
    commentPrefix: 'duckling',
    maxRetries: 3,
    ampApiKey: '',
    openaiApiKey: '',
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
  };

  constructor(private db: DatabaseManager) {}

  get<K extends keyof SettingsDefaults>(key: K): SettingsDefaults[K] {
    const setting = this.db.getSetting(key);
    if (setting?.value !== undefined) {
      // Handle number conversion
      if (typeof SettingsManager.DEFAULTS[key] === 'number') {
        return parseInt(setting.value) as SettingsDefaults[K];
      }
      return setting.value as SettingsDefaults[K];
    }
    return SettingsManager.DEFAULTS[key];
  }

  set<K extends keyof SettingsDefaults>(
    key: K,
    value: SettingsDefaults[K]
  ): void {
    this.db.setSetting(key, String(value));
  }

  getAll(): SettingsDefaults {
    const settings: Record<string, any> = {};
    for (const key of Object.keys(SettingsManager.DEFAULTS) as Array<
      keyof SettingsDefaults
    >) {
      settings[key] = this.get(key);
    }
    return settings as SettingsDefaults;
  }

  static getDefaults(): SettingsDefaults {
    return { ...SettingsManager.DEFAULTS };
  }
}
