import { CodingTool } from '../types';
import { DatabaseManager } from './database';
import { DEFAULT_CODING_PROMPT } from './prompts';

export interface SettingsDefaults {
  defaultCodingTool: CodingTool;
  branchPrefix: string;
  prTitlePrefix: string;
  commitSuffix: string;
  commentPrefix: string;
  maxRetries: number;
  openaiApiKey: string;
  customPrompt: string;
}

export class SettingsManager {
  private static readonly DEFAULTS: SettingsDefaults = {
    defaultCodingTool: 'amp',
    branchPrefix: 'duckling-',
    prTitlePrefix: '[DUCKLING]',
    commitSuffix: ' [quack]',
    commentPrefix: 'duckling',
    maxRetries: 3,
    openaiApiKey: '',
    customPrompt: DEFAULT_CODING_PROMPT,
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
}
