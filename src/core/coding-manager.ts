import { withRetry } from '../utils/retry';
import { CodingTool } from '../types';
import { logger } from '../utils/logger';
import { DatabaseManager } from './database';
import { execCommand, execCommandWithInput } from '../utils/exec';

interface CodingContext {
  taskId: number;
  repositoryPath: string;
}

export class CodingManager {
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  async generateCode(
    tool: CodingTool,
    prompt: string,
    context: CodingContext
  ): Promise<string> {
    return await withRetry(
      async () => {
        switch (tool) {
          case 'amp':
            return await this.callAmp(prompt, context);
          case 'openai':
            return await this.callCodex(prompt, context);
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
      // Get API key from settings
      const apiKeySetting = this.db.getSetting('ampApiKey');
      if (!apiKeySetting) {
        throw new Error('Amp API key not configured');
      }

      // Check if amp is available
      await execCommand('which', ['amp'], {
        taskId: taskId.toString(),
        cwd: repositoryPath,
      });

      // Call amp with the prompt via stdin
      const result = await execCommandWithInput('amp', prompt, [], {
        taskId: taskId.toString(),
        cwd: repositoryPath,
        timeout: 30 * 60 * 1000, // 30 minutes timeout
        env: {
          ...process.env,
          AMP_API_KEY: apiKeySetting.value,
        },
      });

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || result.stdout || 'Amp command failed');
      }

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

  private async callCodex(
    prompt: string,
    context: CodingContext
  ): Promise<string> {
    const { taskId, repositoryPath } = context;

    try {
      // Get API key from settings
      const apiKeySetting = this.db.getSetting('openaiApiKey');
      if (!apiKeySetting) {
        throw new Error('OpenAI API key not configured');
      }

      // Check if codex is available
      await execCommand('which', ['codex'], {
        taskId: taskId.toString(),
        cwd: repositoryPath,
      });

      const result = await execCommand(
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
            OPENAI_API_KEY: apiKeySetting.value,
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

  async requestFixes(
    tool: CodingTool,
    originalPrompt: string,
    errorMessages: string[],
    context: CodingContext
  ): Promise<string> {
    logger.info(
      'Requesting fixes for precommit errors',
      context.taskId.toString()
    );

    const fixPrompt = `
Original request: ${originalPrompt}

The following errors occurred during precommit checks:
${errorMessages.map((error) => `- ${error}`).join('\n')}

Please fix these issues and provide the corrected implementation. Focus only on fixing the specific errors mentioned above.
`;

    return await this.generateCode(tool, fixPrompt, context);
  }
}
