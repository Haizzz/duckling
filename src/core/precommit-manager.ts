import { withRetry } from '../utils/retry';
import { DatabaseManager } from './database';
import { PrecommitCheck } from '../types';
import { logger } from '../utils/logger';
import { execShellCommand } from '../utils/exec';

export class PrecommitManager {
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  async runChecks(taskId: number): Promise<{ passed: boolean; errors: string[] }> {
    const checks = this.db.getEnabledPrecommitChecks();
    const errors: string[] = [];

    logger.info(`Running ${checks.length} precommit checks`, taskId.toString());

    for (const check of checks) {
      try {
        await this.runSingleCheck(check, taskId);
        this.logCheckResult(taskId, check.name, true, null);
      } catch (error: any) {
        const errorMessage = `${check.name}: ${error.message}`;
        errors.push(errorMessage);
        this.logCheckResult(taskId, check.name, false, error.message);
      }
    }

    const passed = errors.length === 0;
    logger.info(`Precommit checks ${passed ? 'passed' : 'failed'} (${errors.length} errors)`, taskId.toString());

    return {
      passed,
      errors
    };
  }

  private async runSingleCheck(check: PrecommitCheck, taskId: number): Promise<void> {
    logger.info(`Running precommit check: ${check.name}`, taskId.toString());

    await withRetry(async () => {
      const result = await execShellCommand(check.command, {
        taskId: taskId.toString(),
        timeout: 300000, // 5 minutes timeout
        cwd: process.cwd()
      });

      if (result.exitCode !== 0) {
        // Command failed
        const errorOutput = result.stderr || result.stdout || 'Command failed with no output';
        throw new Error(errorOutput);
      }

      return result.stdout;
    }, `Run precommit check: ${check.name}`, 2);
  }



  private logCheckResult(taskId: number, checkName: string, passed: boolean, error: string | null): void {
    const level = passed ? 'info' : 'error';
    const message = passed
      ? `Precommit check '${checkName}' passed`
      : `Precommit check '${checkName}' failed: ${error}`;

    this.db.addTaskLog({
      task_id: taskId,
      level,
      message
    });
  }

  // Delegate to database manager for CRUD operations
  async addCheck(check: Omit<PrecommitCheck, 'id' | 'created_at'>): Promise<number> {
    return this.db.addPrecommitCheck(check);
  }

  async updateCheck(id: number, updates: Partial<PrecommitCheck>): Promise<void> {
    return this.db.updatePrecommitCheck(id, updates);
  }

  async deleteCheck(id: number): Promise<void> {
    return this.db.deletePrecommitCheck(id);
  }

  getAllChecks(): PrecommitCheck[] {
    return this.db.getAllPrecommitChecks();
  }
}
