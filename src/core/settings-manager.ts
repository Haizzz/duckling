import { DatabaseManager } from './database';
import { CodingTool } from '../types';

export interface SettingsDefaults {
  githubUsername: string;
  githubToken: string;
  repositoryUrl: string;
  defaultCodingTool: CodingTool;
  branchPrefix: string;
  baseBranch: string;
  prTitlePrefix: string;
  commitSuffix: string;
  maxRetries: number;
  ampApiKey: string;
  openaiApiKey: string;
}

export class SettingsManager {
  private static readonly DEFAULTS: SettingsDefaults = {
    githubUsername: '',
    githubToken: '',
    repositoryUrl: '',
    defaultCodingTool: 'amp',
    branchPrefix: 'duckling-',
    baseBranch: 'main',
    prTitlePrefix: '[DUCKLING]',
    commitSuffix: ' [quack]',
    maxRetries: 3,
    ampApiKey: '',
    openaiApiKey: '',
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
