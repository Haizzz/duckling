import { EventEmitter } from 'events';
import { DatabaseManager } from './database';
import { SettingsManager } from './settings-manager';
import { GitManager } from './git-manager';
import { CodingManager } from './coding-manager';
import { PrecommitManager } from './precommit-manager';
import { PRManager } from './pr-manager';
import { OpenAIManager } from './openai-manager';
import { Task, TaskStatus, CodingTool, TaskUpdateEvent, CreateTaskRequest } from '../types';
import { taskExecutor } from './task-executor';
import { logger } from '../utils/logger';

export class CoreEngine extends EventEmitter {
  private db: DatabaseManager;
  private settings: SettingsManager;
  private gitManager: GitManager;
  private codingManager: CodingManager;
  private precommitManager: PrecommitManager;
  private prManager?: PRManager;
  private openaiManager: OpenAIManager;
  private isInitialized = false;
  private processingInterval?: NodeJS.Timeout;
  private isProcessing = false;

  constructor(db: DatabaseManager, repoPath: string = process.cwd()) {
    super();
    this.db = db;
    this.settings = new SettingsManager(db);
    this.openaiManager = new OpenAIManager(db);
    this.gitManager = new GitManager(db, repoPath, this.openaiManager);
    this.codingManager = new CodingManager(db);
    this.precommitManager = new PrecommitManager(db);
  }

  private getPRManager(): PRManager {
    if (this.prManager) {
      return this.prManager;
    }

    const githubToken = this.settings.get('githubToken');
    if (!githubToken) {
      logger.error('GitHub token not configured. PR operations will be skipped. Please configure GitHub settings.');
      throw new Error('GitHub token not configured. PR operations will be skipped. Please configure GitHub settings.');
    }

    try {
      this.prManager = new PRManager(githubToken, this.db, this.openaiManager);
      return this.prManager;
    } catch (error) {
      const errorMsg = `Failed to initialize PR manager: ${error}`;
      logger.error(errorMsg);
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Start periodic task processing based on state
    this.startTaskProcessing();

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
    logger.info(`Task created: ${request.title} ${taskId.toString()}`);

    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: `Task created: ${request.title}`
    });

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

    // Task will be picked up by periodic processing

    this.emitTaskUpdate(taskId, 'pending');
  }

  private startTaskProcessing(): void {
    // Start processing cycle - handles both tasks and reviews
    this.startProcessingInterval();
  }

  private startProcessingInterval(): void {
    this.processingInterval = setInterval(async () => {
      // Skip if already processing to prevent overlap
      if (this.isProcessing) {
        logger.info('Processing already in progress, skipping cycle');
        return;
      }

      this.isProcessing = true;
      try {
        await this.processReviews();
        await this.processPendingTasks();
      } catch (error) {
        logger.error(`Error in processing cycle: ${error}`);
      } finally {
        this.isProcessing = false;
      }
    }, 300000); // 5 minutes
  }

  private async processPendingTasks(): Promise<void> {
    // Process pending tasks
    const pendingTasks = this.db.getTasks({ status: 'pending' });

    for (const task of pendingTasks) {
      await this.processTask(task.id);
    }
  }

  private async processReviews(): Promise<void> {
    // Collect all new comments for all awaiting-review tasks first
    const awaitingReviewTasks = this.db.getTasks({ status: 'awaiting-review' });
    const allNewComments: Array<{ taskId: number; comments: Array<{ id: string; body: string }> }> = [];
    const taskStatusUpdates: Array<{ taskId: number; status: 'completed' | 'cancelled' }> = [];

    // First pass: collect all new comments and check PR statuses
    for (const task of awaitingReviewTasks) {
      if (task.pr_number) {
        try {
          const result = await this.collectPRComments(task.id, task.pr_number);
          if (result.comments.length > 0) {
            allNewComments.push({ taskId: task.id, comments: result.comments });
          }
          if (result.statusUpdate) {
            taskStatusUpdates.push({ taskId: task.id, status: result.statusUpdate });
          }
        } catch (error: any) {
          this.db.addTaskLog({
            task_id: task.id,
            level: 'error',
            message: `Error collecting PR comments: ${error.message}`
          });
        }
      }
    }

    // Second pass: handle all collected comments
    for (const { taskId, comments } of allNewComments) {
      for (const comment of comments) {
        try {
          await this.handlePRComment(taskId, comment.body);
          // Update last processed comment ID
          this.db.setSetting(`last_comment_${taskId}`, comment.id.toString(), 'system');
        } catch (error: any) {
          this.db.addTaskLog({
            task_id: taskId,
            level: 'error',
            message: `Error handling PR comment: ${error.message}`
          });
        }
      }
    }

    // Third pass: update task statuses based on PR status
    for (const { taskId, status } of taskStatusUpdates) {
      if (status === 'completed') {
        this.db.updateTask(taskId, {
          status: 'completed',
          current_stage: 'completed',
          completed_at: new Date().toISOString()
        });
        this.emitTaskUpdate(taskId, 'completed');
      } else if (status === 'cancelled') {
        this.db.updateTask(taskId, { status: 'cancelled', current_stage: 'cancelled' });
        this.emitTaskUpdate(taskId, 'cancelled');
      }
    }
  }

  private async processTask(taskId: number): Promise<void> {
    logger.info(`Processing task: ${taskId}`);
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
            await this.gitManager.commitChanges(task.description, taskId);
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
    try {
      const prManager = this.getPRManager();
      const pr = await prManager.createPRFromTask(branchName, task.description, taskId);

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

      // PR comments will be polled by periodic processing
    } catch (error) {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'error',
        message: `Failed to create PR: ${error}`
      });
      // Update task to completed since we can't create PR
      this.db.updateTask(taskId, { status: 'completed', current_stage: 'completed' });
      this.emitTaskUpdate(taskId, 'completed');
    }
  }

  private async collectPRComments(taskId: number, prNumber: number): Promise<{ comments: Array<{ id: string; body: string }>; statusUpdate?: 'completed' | 'cancelled' }> {
    logger.info(`Collecting PR comments for task: ${taskId} ${prNumber}`);
    const task = this.db.getTask(taskId);
    if (!task || task.status !== 'awaiting-review') {
      return { comments: [] }; // Task completed or cancelled
    }

    const prManager = this.getPRManager();
    const githubUsername = this.settings.get('githubUsername');
    if (!githubUsername) return { comments: [] };

    // Get last commit timestamp for the branch
    let lastCommitTimestamp: string | null = null;
    if (task.branch_name) {
      await this.gitManager.switchToBranch(task.branch_name, taskId);

      try {
        lastCommitTimestamp = await this.gitManager.getLastCommitTimestamp(task.branch_name);
        logger.info(`last commit timestamp for branch ${task.branch_name}: ${lastCommitTimestamp}`);
      } catch (error) {
        // If we can't get commit timestamp, continue with null (will get all comments)
        console.warn(`Could not get last commit timestamp for branch ${task.branch_name}:`, error);
      }
    }

    // Poll for new comments since last commit
    const newComments = await prManager.pollForComments(prNumber, lastCommitTimestamp, githubUsername);

    // Check PR status
    const prStatus = await prManager.getPRStatus(prNumber);
    let statusUpdate: 'completed' | 'cancelled' | undefined;

    if (prStatus.merged) {
      statusUpdate = 'completed';
    } else if (prStatus.state === 'closed') {
      statusUpdate = 'cancelled';
    }

    return { comments: newComments, statusUpdate };
  }

  private async handlePRComment(taskId: number, comment: string): Promise<void> {
    logger.info(`Handling PR comment for task: ${taskId} ${comment}`);
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
          await this.gitManager.commitChanges(`Address PR feedback: ${comment}`, taskId);
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
    // Get the full task data to include in the update
    const task = this.db.getTask(taskId);

    const event: TaskUpdateEvent = {
      taskId,
      status,
      metadata: {
        ...metadata,
        task: task // Include full task data
      }
    };

    this.emit('task-update', event);
  }

  shutdown(): void {
    console.log('🔄 Shutting down engine...');

    // Clear processing interval
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }

    // Remove all event listeners
    this.removeAllListeners();

    console.log('✅ Engine shutdown complete');
  }
}
