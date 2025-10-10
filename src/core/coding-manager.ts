import { withRetry } from '../utils/retry';
import { CodingTool } from '../types';
import {
  execCommandStreaming,
  execCommandWithInputStreaming,
} from '../utils/exec';
import { createCodingPrompt } from './prompts';
import { SettingsManager } from './settings-manager';
import { DatabaseManager } from './database';

interface CodingContext {
  taskId: number;
  repositoryPath: string;
}

export class CodingManager {
  private settings: SettingsManager;
  private db: DatabaseManager;

  constructor(settings: SettingsManager, db: DatabaseManager) {
    this.settings = settings;
    this.db = db;
  }

  async generateCode(
    tool: CodingTool,
    prompt: string,
    context: CodingContext
  ): Promise<string> {
    const customPrompt = this.settings.get('customPrompt');
    const enhancedPrompt = createCodingPrompt(prompt, customPrompt);

    return await withRetry(
      async () => {
        switch (tool) {
          case 'amp':
            return await this.callAmp(enhancedPrompt, context);
          case 'openai':
            return await this.callCodex(enhancedPrompt, context);
          case 'claude':
            return await this.callClaude(enhancedPrompt, context);
          default:
            throw new Error(`Unsupported coding tool: ${tool}`);
        }
      },
      `Generate code with ${tool}`,
      3
    );
  }

  private async callAmp(
    prompt: string,
    context: CodingContext
  ): Promise<string> {
    const { taskId, repositoryPath } = context;

    try {
      const result = await execCommandWithInputStreaming('amp', prompt, [], {
        taskId: taskId.toString(),
        cwd: repositoryPath,
        timeout: 30 * 60 * 1000, // 30 minutes timeout
        env: {
          ...process.env,
        },
      });

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || result.stdout || 'Amp command failed');
      }

      // Extract and log Amp thread URL if present
      this.extractAndLogThreadUrl(result.stdout, taskId);

      return result.stdout;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(
          "Amp CLI not found. Please install amp and ensure it's in your PATH. Requires Node.js v22+."
        );
      }
      throw error;
    }
  }

  private extractAndLogThreadUrl(output: string, taskId: number): void {
    // Amp thread URL format: https://ampcode.com/threads/T-{uuid}
    const threadUrlRegex = /https:\/\/ampcode\.com\/threads\/T-[a-f0-9-]+/i;
    const match = output.match(threadUrlRegex);

    if (match) {
      const threadUrl = match[0];
      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🔗 Amp Thread: ${threadUrl}`,
      });
    }
  }

  private async callCodex(
    prompt: string,
    context: CodingContext
  ): Promise<string> {
    const { taskId, repositoryPath } = context;

    try {
      // Get API key from settings
      const apiKey = this.settings.get('openaiApiKey');
      if (!apiKey) {
        throw new Error('OpenAI API key not configured');
      }

      const result = await execCommandStreaming(
        'codex',
        [
          '--disable-response-storage',
          '--auto-edit',
          '--quiet',
          '--full-stdout',
          prompt,
        ],
        {
          taskId: taskId.toString(),
          cwd: repositoryPath,
          timeout: 30 * 60 * 1000, // 30 minutes timeout
          env: {
            ...process.env,
            OPENAI_API_KEY: apiKey,
          },
        }
      );

      if (result.exitCode !== 0) {
        throw new Error(
          result.stderr || result.stdout || 'Codex command failed'
        );
      }

      return result.stdout;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(
          "Codex CLI not found. Please install codex and ensure it's in your PATH."
        );
      }
      throw error;
    }
  }

  private async callClaude(
    prompt: string,
    context: CodingContext
  ): Promise<string> {
    const { taskId, repositoryPath } = context;

    try {
      const result = await execCommandWithInputStreaming('claude', prompt, [], {
        taskId: taskId.toString(),
        cwd: repositoryPath,
        timeout: 30 * 60 * 1000, // 30 minutes timeout
        env: {
          ...process.env,
        },
      });

      if (result.exitCode !== 0) {
        throw new Error(
          result.stderr || result.stdout || 'Claude command failed'
        );
      }

      return result.stdout;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(
          "Claude CLI not found. Please install claude and ensure it's in your PATH."
        );
      }
      throw error;
    }
  }
}
