import { db } from '../core/database';

export interface TaskLoggingOptions {
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
  } catch (error) {
    // Log failure message
    const errorMessage = error instanceof Error ? error.message : String(error);
    db.addTaskLog({
      task_id: taskId,
      level: 'error',
      message: `${failureMessage}: ${errorMessage}`,
    });

    throw error;
  }
}