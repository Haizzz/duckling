import { EventEmitter } from 'events';
import { DatabaseManager } from './database';
import { SQLiteJobQueue } from './job-queue';
import { GitManager } from './git-manager';
import { CodingManager } from './coding-manager';
import { PrecommitManager } from './precommit-manager';
import { PRManager } from './pr-manager';
import { OpenAIManager } from './openai-manager';
import { Task, TaskStatus, CodingTool, TaskUpdateEvent, CreateTaskRequest } from '../types';
import { generateId } from '../utils/retry';
import { taskExecutor } from './task-executor';
import { logger } from '../utils/logger';

export class CoreEngine extends EventEmitter {
  private db: DatabaseManager;
  private jobQueue: SQLiteJobQueue;
  private gitManager: GitManager;
  private codingManager: CodingManager;
  private precommitManager: PrecommitManager;
  private prManager: PRManager;
  private openaiManager: OpenAIManager;
  private isInitialized = false;
  private pollingInterval?: NodeJS.Timeout;

  constructor(db: DatabaseManager, repoPath: string = process.cwd()) {
    super();
    this.db = db;
    this.jobQueue = new SQLiteJobQueue(db);
    this.openaiManager = new OpenAIManager(db);
    this.gitManager = new GitManager(db, repoPath, this.openaiManager);
    this.codingManager = new CodingManager(db);
    this.precommitManager = new PrecommitManager(db);

    // Initialize PR manager - GitHub token is required
    const githubToken = this.db.getSetting('githubToken');

    if (!githubToken) {
      throw new Error('GitHub token is required. Please configure GitHub settings before starting the server.');
    }

    this.prManager = new PRManager(githubToken.value, this.db, this.openaiManager);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Set up job processing
    this.setupJobProcessors();

    // Recovery: reset any jobs that were processing when server shut down
    this.jobQueue.resetProcessingJobs();

    // Start polling for PR comments if configured
    this.startPRCommentPolling();

    this.isInitialized = true;
  }

  async createTask(request: CreateTaskRequest): Promise<number> {
    // Generate summary using OpenAI
    let summary: string | undefined;
    try {
      summary = await this.openaiManager.generateTaskSummary(request.description);
    } catch (error) {
      logger.warn(`Failed to generate task summary: ${error}`);
      // Continue without summary - will fallback in UI
      summary = undefined;
    }

    const task = {
      title: request.title,
      description: request.description,
      summary,
      status: 'pending' as TaskStatus,
      coding_tool: request.codingTool
    };

    // Store task in database - returns auto-generated ID
    const taskId = this.db.createTask(task);
    logger.info(`Task created: ${request.title}`, taskId.toString());

    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: `Task created: ${request.title}`
    });

    // Enqueue task for processing
    this.jobQueue.enqueue('process-task', { taskId: taskId.toString() }, { maxAttempts: 5 });

    // Emit task update event
    this.emitTaskUpdate(taskId, 'pending');

    return taskId;
  }

  async cancelTask(taskId: number): Promise<void> {
    const task = this.db.getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    this.db.updateTask(taskId, {
      status: 'cancelled',
      current_stage: 'cancelled',
      completed_at: new Date().toISOString()
    });

    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: 'Task cancelled by user'
    });

    this.emitTaskUpdate(taskId, 'cancelled');
  }

  async retryTask(taskId: number): Promise<void> {
    const task = this.db.getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    if (task.status !== 'failed') {
      throw new Error('Can only retry failed tasks');
    }

    this.db.updateTask(taskId, { status: 'pending' });

    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: 'Task retry requested'
    });

    // Re-enqueue for processing
    this.jobQueue.enqueue('process-task', { taskId }, { maxAttempts: 5 });

    this.emitTaskUpdate(taskId, 'pending');
  }

  private setupJobProcessors(): void {
    // Main task processor
    this.jobQueue.process('process-task', async (data) => {
      await this.processTask(data.taskId);
    });

    // PR comment processor
    this.jobQueue.process('handle-pr-comment', async (data) => {
      await this.handlePRComment(data.taskId, data.comment);
    });

    // PR polling processor
    this.jobQueue.process('poll-pr-comments', async (data) => {
      await this.pollPRComments(data.taskId, data.prNumber);
    });
  }

  private async processTask(taskId: number): Promise<void> {
    const task = this.db.getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Use task executor to ensure only one task operation at a time
    await taskExecutor.executeTask({
      taskId: taskId,
      operation: 'process-task',
      execute: async () => {
        try {
          // Update status to in progress
          this.db.updateTask(taskId, { status: 'in-progress', current_stage: 'creating_branch' });
          this.emitTaskUpdate(taskId, 'in-progress');

          // Step 1: Create branch
          let baseBranchName: string;
          let branchName: string;

          try {
            baseBranchName = await this.openaiManager.generateBranchName(task.description);
          } catch (error: any) {
            this.db.addTaskLog({
              task_id: taskId,
              level: 'error',
              message: `Failed to generate branch name: ${error.message}`
            });
            throw error;
          }

          try {
            branchName = await this.gitManager.createAndCheckoutBranch(baseBranchName, taskId);
            this.db.updateTask(taskId, { branch_name: branchName });
            this.db.addTaskLog({
              task_id: taskId,
              level: 'info',
              message: `Branch created: ${branchName}`
            });
          } catch (error: any) {
            this.db.addTaskLog({
              task_id: taskId,
              level: 'error',
              message: `Failed to create branch: ${error.message}`
            });
            throw error;
          }

          // Step 2: Generate code
          this.db.updateTask(taskId, { current_stage: 'generating_code' });
          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: `Calling ${task.coding_tool} to generate code...`
          });

          try {
            const generatedCode = await this.codingManager.generateCode(
              task.coding_tool,
              task.description,
              { taskId }
            );

            this.db.addTaskLog({
              task_id: taskId,
              level: 'info',
              message: 'Code generation completed'
            });
          } catch (error: any) {
            this.db.addTaskLog({
              task_id: taskId,
              level: 'error',
              message: `Code generation failed: ${error.message}`
            });
            throw error;
          }

          // Step 3: Run precommit checks
          this.db.updateTask(taskId, { current_stage: 'running_precommit_checks' });

          try {
            await this.runPrecommitChecks(taskId);
          } catch (error: any) {
            this.db.addTaskLog({
              task_id: taskId,
              level: 'error',
              message: `Precommit checks failed: ${error.message}`
            });
            throw error;
          }

          // Step 4: Commit and push changes
          this.db.updateTask(taskId, { current_stage: 'committing_changes' });

          try {
            await this.gitManager.commitChangesWithTask(task.description, taskId);
            await this.gitManager.pushBranch(branchName, taskId);

            this.db.addTaskLog({
              task_id: taskId,
              level: 'info',
              message: 'Changes committed and pushed'
            });
          } catch (error: any) {
            this.db.addTaskLog({
              task_id: taskId,
              level: 'error',
              message: `Failed to commit/push changes: ${error.message}`
            });
            throw error;
          }

          // Step 5: Create PR
          this.db.updateTask(taskId, { current_stage: 'creating_pr' });

          try {
            await this.createPR(taskId, task, branchName);
          } catch (error: any) {
            this.db.addTaskLog({
              task_id: taskId,
              level: 'error',
              message: `Failed to create PR: ${error.message}`
            });
            throw error;
          }

        } catch (error: any) {
          this.db.updateTask(taskId, { status: 'failed', current_stage: 'failed' });
          this.db.addTaskLog({
            task_id: taskId,
            level: 'error',
            message: `Task failed: ${error.message}`
          });
          this.emitTaskUpdate(taskId, 'failed');
          throw error;
        }
      }
    });
  }

  private async runPrecommitChecks(taskId: number): Promise<void> {
    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: 'Running precommit checks...'
    });

    // First run - stop on first failure to get focused error messages
    const firstResult = await this.precommitManager.runChecks(taskId, true);

    if (!firstResult.passed) {
      // Get task to retry with fixes
      const task = this.db.getTask(taskId);
      if (!task) throw new Error('Task not found');

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: 'Precommit checks failed, requesting fixes...'
      });

      // Request fixes from coding tool
      const fixes = await this.codingManager.requestFixes(
        task.coding_tool,
        task.description,
        firstResult.errors,
        { taskId }
      );

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: 'Fixes generated, re-running all precommit checks...'
      });

      // Second run - run all checks without stopping, don't try to fix again
      const secondResult = await this.precommitManager.runChecks(taskId, false);

      if (!secondResult.passed) {
        this.db.addTaskLog({
          task_id: taskId,
          level: 'warn',
          message: `Some precommit checks still failing, but continuing: ${secondResult.errors.join(', ')}`
        });
      }
    }

    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: 'Precommit checks completed'
    });
  }

  private async createPR(taskId: number, task: Task, branchName: string): Promise<void> {
    const pr = await this.prManager.createPRFromTask(branchName, task.description, taskId);

    this.db.updateTask(taskId, {
      status: 'awaiting-review',
      current_stage: 'awaiting_review',
      pr_number: pr.number,
      pr_url: pr.url
    });

    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: `PR created: ${pr.url}`
    });

    this.emitTaskUpdate(taskId, 'awaiting-review');

    // Start polling for comments on this PR
    this.jobQueue.enqueue('poll-pr-comments', { taskId, prNumber: pr.number });
  }

  private async pollPRComments(taskId: number, prNumber: number): Promise<void> {
    const task = this.db.getTask(taskId);
    if (!task || task.status !== 'awaiting-review') {
      return; // Task completed or cancelled
    }

    const githubUsername = this.db.getSetting('githubUsername')?.value;
    if (!githubUsername) return;

    try {
      // Get last commit timestamp for the branch
      let lastCommitTimestamp: string | null = null;
      if (task.branch_name) {
        try {
          lastCommitTimestamp = await this.gitManager.getLastCommitTimestamp(task.branch_name);
        } catch (error) {
          // If we can't get commit timestamp, continue with null (will get all comments)
          console.warn(`Could not get last commit timestamp for branch ${task.branch_name}:`, error);
        }
      }

      // Poll for new comments since last commit
      const newComments = await this.prManager.pollForComments(prNumber, lastCommitTimestamp, githubUsername);

      for (const comment of newComments) {
        // Process each new comment
        this.jobQueue.enqueue('handle-pr-comment', { taskId, comment: comment.body });

        // Update last processed comment ID
        this.db.setSetting(`last_comment_${taskId}`, comment.id.toString(), 'system');
      }

      // Check PR status
      const prStatus = await this.prManager.getPRStatus(prNumber);
      if (prStatus.merged) {
        this.db.updateTask(taskId, {
          status: 'completed',
          current_stage: 'completed',
          completed_at: new Date().toISOString()
        });
        this.emitTaskUpdate(taskId, 'completed');
        return;
      } else if (prStatus.state === 'closed') {
        this.db.updateTask(taskId, { status: 'cancelled', current_stage: 'cancelled' });
        this.emitTaskUpdate(taskId, 'cancelled');
        return;
      }

      // Schedule next poll
      const pollInterval = parseInt(this.db.getSetting('pollInterval')?.value || '30') * 1000;
      this.jobQueue.enqueue('poll-pr-comments', { taskId, prNumber }, { delay: pollInterval });

    } catch (error: any) {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'error',
        message: `Error polling PR comments: ${error.message}`
      });

      // Retry polling after a delay
      this.jobQueue.enqueue('poll-pr-comments', { taskId, prNumber }, { delay: 60000 }); // 1 minute delay
    }
  }

  private async handlePRComment(taskId: number, comment: string): Promise<void> {
    const task = this.db.getTask(taskId);
    if (!task) return;

    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: `Processing PR comment: ${comment.substring(0, 100)}...`
    });

    // Use task executor to ensure only one task operation at a time
    await taskExecutor.executeTask({
      taskId: taskId,
      operation: 'handle-pr-comment',
      execute: async () => {
        try {
          // Generate response/fixes based on comment
          const response = await this.codingManager.generateCode(
            task.coding_tool,
            `Original task: ${task.description}\n\nPR review comment: ${comment}\n\nPlease address this feedback.`,
            { taskId }
          );

          // Fetch latest changes and switch to task branch
          if (task.branch_name) {
            await this.gitManager.switchToBranch(task.branch_name, taskId);
          }

          // Apply changes and run checks
          await this.runPrecommitChecks(taskId);

          // Commit and push changes
          await this.gitManager.commitChanges(`Address PR feedback: ${comment.substring(0, 50)}...`, taskId);
          if (task.branch_name) {
            await this.gitManager.pushBranch(task.branch_name, taskId);
          }

          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: 'PR feedback addressed and changes pushed'
          });

        } catch (error: any) {
          this.db.addTaskLog({
            task_id: taskId,
            level: 'error',
            message: `Error handling PR comment: ${error.message}`
          });
          throw error;
        }
      }
    });
  }



  private emitTaskUpdate(taskId: number, status: TaskStatus, metadata?: any): void {
    const event: TaskUpdateEvent = {
      taskId,
      status,
      metadata
    };

    this.emit('task-update', event);
  }

  private startPRCommentPolling(): void {
    // Poll every 30 seconds for all tasks awaiting review
    this.pollingInterval = setInterval(() => {
      this.pollAllAwaitingTasks().catch(error => {
        logger.error('Error in PR comment polling:', error);
      });
    }, 30000); // 30 seconds
  }

  private async pollAllAwaitingTasks(): Promise<void> {
    const awaitingTasks = this.db.getTasks({ status: 'awaiting-review' });

    for (const task of awaitingTasks) {
      if (task.pr_number) {
        try {
          await this.pollPRComments(task.id, task.pr_number);
        } catch (error) {
          logger.error(`Error polling comments for task ${task.id}: ${error}`);
        }
      }
    }
  }

  shutdown(): void {
    console.log('🔄 Shutting down engine...');

    // Clear polling interval
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }

    // Shutdown job queue
    this.jobQueue.shutdown();

    // Remove all event listeners
    this.removeAllListeners();

    console.log('✅ Engine shutdown complete');
  }
}
