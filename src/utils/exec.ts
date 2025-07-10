import { execa } from 'execa';
import type { Options as ExecaOptions } from 'execa';
import { logger } from './logger';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function execCommand(
  command: string,
  args: string[] = [],
  options: ExecaOptions & { taskId?: string; cwd?: string } = {}
): Promise<ExecResult> {
  const { taskId, ...execaOptions } = options;
  const cwd = options.cwd || process.cwd();

  // Log the command being executed
  logger.logCommand(command, args, cwd, taskId);

  try {
    const result = await execa(command, args, {
      reject: false, // Don't throw on non-zero exit codes
      ...execaOptions,
    });

    // Log the result
    logger.logCommandResult(
      command,
      result.exitCode,
      result.stdout,
      result.stderr,
      taskId
    );

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  } catch (error: any) {
    // Log the error
    logger.logCommandResult(
      command,
      error.exitCode || 1,
      error.stdout,
      error.stderr,
      taskId
    );

    // Re-throw the error
    throw error;
  }
}

export async function execCommandWithStreaming(
  command: string,
  args: string[] = [],
  options: ExecaOptions & { taskId?: string; cwd?: string } = {}
): Promise<ExecResult> {
  const { taskId, ...execaOptions } = options;
  const cwd = options.cwd || process.cwd();

  // Log the command being executed
  logger.logCommand(command, args, cwd, taskId);

  try {
    const subprocess = execa(command, args, {
      reject: false, // Don't throw on non-zero exit codes
      ...execaOptions,
    });

    let stdout = '';
    let stderr = '';

    // Stream stdout in real-time
    subprocess.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      // Log each chunk as it comes in
      logger.info(`[stdout] ${chunk.replace(/\n$/, '')}`, taskId);
    });

    // Stream stderr in real-time
    subprocess.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      // Log each chunk as it comes in
      logger.error(`[stderr] ${chunk.replace(/\n$/, '')}`, taskId);
    });

    const result = await subprocess;

    // Log the final result
    logger.logCommandResult(command, result.exitCode, stdout, stderr, taskId);

    return {
      stdout,
      stderr,
      exitCode: result.exitCode,
    };
  } catch (error: any) {
    // Log the error
    logger.logCommandResult(
      command,
      error.exitCode || 1,
      error.stdout,
      error.stderr,
      taskId
    );

    // Re-throw the error
    throw error;
  }
}

export async function execCommandWithInput(
  command: string,
  input: string,
  args: string[] = [],
  options: ExecaOptions & { taskId?: string; cwd?: string } = {}
): Promise<ExecResult> {
  const { taskId, ...execaOptions } = options;
  const cwd = options.cwd || process.cwd();

  // Log the command being executed
  logger.logCommand(command, args, cwd, taskId);

  try {
    const subprocess = execa(command, args, {
      reject: false, // Don't throw on non-zero exit codes
      input,
      ...execaOptions,
    });

    let stdout = '';
    let stderr = '';

    // Stream stdout in real-time
    subprocess.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      // Log each chunk as it comes in
      logger.info(`[stdout] ${chunk.replace(/\n$/, '')}`, taskId);
    });

    // Stream stderr in real-time
    subprocess.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      // Log each chunk as it comes in
      logger.error(`[stderr] ${chunk.replace(/\n$/, '')}`, taskId);
    });

    const result = await subprocess;

    // Log the final result
    logger.logCommandResult(command, result.exitCode, stdout, stderr, taskId);

    return {
      stdout,
      stderr,
      exitCode: result.exitCode,
    };
  } catch (error: any) {
    // Log the error
    logger.logCommandResult(
      command,
      error.exitCode || 1,
      error.stdout,
      error.stderr,
      taskId
    );

    // Re-throw the error
    throw error;
  }
}

export async function execShellCommand(
  command: string,
  options: ExecaOptions & { taskId?: string; cwd?: string } = {}
): Promise<ExecResult> {
  return execCommand('bash', ['-c', command], options);
}
