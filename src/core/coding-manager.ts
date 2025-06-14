import { withRetry } from '../utils/retry';
import { CodingTool } from '../types';
import { logger } from '../utils/logger';
import { DatabaseManager } from './database';
import { execCommand, execCommandWithInput } from '../utils/exec';

export class CodingManager {
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  async generateCode(
    tool: CodingTool,
    prompt: string,
    context: { files?: string[]; taskId: number }
  ): Promise<string> {
    return await withRetry(async () => {
      switch (tool) {
        case 'amp':
          return await this.callAmp(prompt, context);
        case 'openai':
          return await this.callCodex(prompt, context);
        default:
          throw new Error(`Unsupported coding tool: ${tool}`);
      }
    }, `Generate code with ${tool}`, 3);
  }

  private async callAmp(prompt: string, context: any): Promise<string> {
    const { taskId } = context;

    try {
      // Get API key from settings
      const apiKeySetting = this.db.getSetting('ampApiKey');
      if (!apiKeySetting) {
        throw new Error('Amp API key not configured');
      }

      // Check if amp is available
      await execCommand('which', ['amp'], { taskId });

      // Call amp with the prompt via stdin
      const result = await execCommandWithInput('amp', prompt, [], {
        taskId,
        timeout: 300000, // 5 minutes timeout
        env: {
          ...process.env,
          AMP_API_KEY: apiKeySetting.value,
          NODE_ENV: 'production' // Use Node 22 for amp
        }
      });

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || result.stdout || 'Amp command failed');
      }

      return result.stdout;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error('Amp CLI not found. Please install amp and ensure it\'s in your PATH. Requires Node.js v22+.');
      }
      throw error;
    }
  }

  private async callCodex(prompt: string, context: any): Promise<string> {
    const { taskId } = context;

    try {
      // Get API key from settings
      const apiKeySetting = this.db.getSetting('openaiApiKey');
      if (!apiKeySetting) {
        throw new Error('OpenAI API key not configured');
      }

      // Check if codex is available
      await execCommand('which', ['codex'], { taskId });

      const result = await execCommand('codex', ['-q', prompt], {
        taskId,
        timeout: 300000,
        env: {
          ...process.env,
          OPENAI_API_KEY: apiKeySetting.value
        }
      });

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || result.stdout || 'Codex command failed');
      }

      return result.stdout;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error('Codex CLI not found. Please install codex and ensure it\'s in your PATH.');
      }
      throw error;
    }
  }

  async requestFixes(
    tool: CodingTool,
    originalPrompt: string,
    errorMessages: string[],
    context: { files?: string[]; taskId: number }
  ): Promise<string> {
    logger.info('Requesting fixes for precommit errors', context.taskId);

    const fixPrompt = `
Original request: ${originalPrompt}

The following errors occurred during precommit checks:
${errorMessages.map(error => `- ${error}`).join('\n')}

Please fix these issues and provide the corrected implementation. Focus only on fixing the specific errors mentioned above.
`;

    return await this.generateCode(tool, fixPrompt, context);
  }
}
