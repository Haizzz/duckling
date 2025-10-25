import { DatabaseManager } from '../core/database';
import { toMessage } from './error-utils';

interface TaskLoggingOptions {
  taskId: number;
  startMessage: string;
  completeMessage: string;
  failureMessage: string;
}

/**
 * Wrapper utility for task logging that adds start, complete, and failure messages
 * around a main action to reduce verbosity in task execution code
 */
export async function withTaskLogMessages<T>(
  db: DatabaseManager,
  options: TaskLoggingOptions,
  action: () => Promise<T>
): Promise<T> {
  const { taskId, startMessage, completeMessage, failureMessage } = options;

  // Log start message
  db.addTaskLog({
    task_id: taskId,
    level: 'info',
    message: startMessage,
  });

  try {
    const result = await action();

    // Log completion message
    db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: completeMessage,
    });

    return result;
  } catch (error: unknown) {
    // Log failure message
    db.addTaskLog({
      task_id: taskId,
      level: 'error',
      message: `${failureMessage}: ${toMessage(error)}`,
    });

    throw error;
  }
}
