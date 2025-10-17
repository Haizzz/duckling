import { CodingTool } from '../types';
import { DatabaseManager } from './database';
import { DEFAULT_CODING_PROMPT } from './prompts';
import { execShellCommand } from '../utils/exec';

interface SettingsDefaults {
  defaultCodingTool: CodingTool;
  branchPrefix: string;
  prTitlePrefix: string;
  commitSuffix: string;
  commentPrefix: string;
  maxRetries: number;
  openaiApiKey: string;
  ampApiKey: string;
  jiraApiKey: string;
  jiraEmail: string;
  jiraJqlQuery: string;
  jiraBaseUrl: string;
  jiraRepository: string;
  customPrompt: string;
  skipUsernameCheck: boolean;
}

export class SettingsManager {
  private static readonly DEFAULTS: SettingsDefaults = {
    defaultCodingTool: 'amp',
    branchPrefix: 'duckling-',
    prTitlePrefix: '',
    commitSuffix: ' [quack]',
    commentPrefix: 'duckling',
    maxRetries: 3,
    openaiApiKey: '',
    ampApiKey: '',
    jiraApiKey: '',
    jiraEmail: '',
    jiraJqlQuery: '',
    jiraBaseUrl: '',
    jiraRepository: '',
    customPrompt: DEFAULT_CODING_PROMPT,
    skipUsernameCheck: false,
  };

  constructor(private db: DatabaseManager) {}

  get<K extends keyof SettingsDefaults>(key: K): SettingsDefaults[K] {
    const setting = this.db.getSetting(key);
    if (setting?.value !== undefined) {
      // Handle number conversion
      if (typeof SettingsManager.DEFAULTS[key] === 'number') {
        return parseInt(setting.value) as SettingsDefaults[K];
      }
      // Handle boolean conversion
      if (typeof SettingsManager.DEFAULTS[key] === 'boolean') {
        return (setting.value === 'true') as SettingsDefaults[K];
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
    this.executeHook(key, String(value));
  }

  private async executeHook(settingName: string, value: string): Promise<void> {
    const hook = this.db.getSettingsHook(settingName);
    if (hook) {
      try {
        const command = `${hook.command} "${value}"`;
        await execShellCommand(command);
      } catch (error: any) {
        console.error(
          `Failed to execute hook for ${settingName}:`,
          error.message
        );
      }
    }
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
