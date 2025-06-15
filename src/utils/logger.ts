import fs from 'fs';
import path from 'path';
import { LOGS_DIR, LogLevel } from './constants';

export class Logger {
  private static instance: Logger;

  constructor() {
    // Ensure logs directory exists
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private writeLog(level: LogLevel, message: string, taskId?: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${taskId ? `[${taskId}] ` : ''}${message}`;

    // Write to console
    console.log(logEntry);

    // Write to file
    const logFile = path.join(
      LOGS_DIR,
      `duckling-${new Date().toISOString().split('T')[0]}.log`
    );
    fs.appendFileSync(logFile, logEntry + '\n');

    // Also write to task-specific log if taskId provided
    if (taskId) {
      const taskLogFile = path.join(LOGS_DIR, `task-${taskId}.log`);
      fs.appendFileSync(taskLogFile, logEntry + '\n');
    }
  }

  debug(message: string, taskId?: string): void {
    this.writeLog('debug', message, taskId);
  }

  info(message: string, taskId?: string): void {
    this.writeLog('info', message, taskId);
  }

  warn(message: string, taskId?: string): void {
    this.writeLog('warn', message, taskId);
  }

  error(message: string, taskId?: string): void {
    this.writeLog('error', message, taskId);
  }

  // Log command execution
  logCommand(
    command: string,
    args: string[],
    cwd: string,
    taskId?: string
  ): void {
    this.info(`Executing: ${command} ${args.join(' ')} (cwd: ${cwd})`, taskId);
  }

  // Log command result
  logCommandResult(
    command: string,
    exitCode: number,
    stdout?: string,
    stderr?: string,
    taskId?: string
  ): void {
    if (exitCode === 0) {
      this.info(`Command succeeded: ${command}`, taskId);
      if (stdout) {
        this.debug(`stdout: ${stdout}`, taskId);
      }
    } else {
      this.error(`Command failed: ${command} (exit code: ${exitCode})`, taskId);
      if (stderr) {
        this.error(`stderr: ${stderr}`, taskId);
      }
      if (stdout) {
        this.debug(`stdout: ${stdout}`, taskId);
      }
    }
  }
}

export const logger = Logger.getInstance();
