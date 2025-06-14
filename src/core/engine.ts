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
  private prManager: PRManager | null = null;
  private openaiManager: OpenAIManager;
  private isInitialized = false;

  constructor(db: DatabaseManager, repoPath: string = process.cwd()) {
    super();
    this.db = db;
    this.jobQueue = new SQLiteJobQueue(db);
    this.openaiManager = new OpenAIManager(db);
    this.gitManager = new GitManager(db, repoPath, this.openaiManager);
    this.codingManager = new CodingManager(db);
    this.precommitManager = new PrecommitManager(db);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Initialize PR manager if GitHub settings are available
    const githubToken = this.db.getSetting('githubToken');
    
    if (githubToken) {
      this.prManager = new PRManager(githubToken.value, this.db, this.openaiManager);
    }

    // Set up job processing
    this.setupJobProcessors();

    // Recovery: reset any jobs that were processing when server shut down
    this.jobQueue.resetProcessingJobs();

    // Start polling for PR comments if configured
    this.startPRCommentPolling();

    this.isInitialized = true;
  }

  async createTask(request: CreateTaskRequest): Promise<string> {
    const taskId = generateId();
    
    // Generate summary using OpenAI
    let summary: string | undefined;
    try {
      summary = await this.openaiManager.generateTaskSummary(request.description);
    } catch (error) {
      logger.warn(`Failed to generate task summary: ${error}`);
      // Continue without summary - will fallback in UI
    }
    
    const task: Task = {
      id: taskId,
      title: request.title,
      description: request.description,
      summary,
      status: 'pending',
      coding_tool: request.codingTool,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Store task in database
    this.db.createTask(task);

    // Log task creation
    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: `Task created: ${request.title}`
    });

    // Enqueue task for processing
    this.jobQueue.enqueue('process-task', { taskId }, { maxAttempts: 5 });

    // Emit task update event
    this.emitTaskUpdate(taskId, 'pending');

    return taskId;
  }

  async cancelTask(taskId: string): Promise<void> {
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

  async retryTask(taskId: string): Promise<void> {
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

  private async processTask(taskId: string): Promise<void> {
    const task = this.db.getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Use task executor to ensure only one task operation at a time
    await taskExecutor.executeTask({
      taskId,
      operation: 'process-task',
      execute: async () => {
        try {
          // Update status to in progress
          this.db.updateTask(taskId, { status: 'in-progress', current_stage: 'creating_branch' });
          this.emitTaskUpdate(taskId, 'in-progress');

          // Step 1: Create branch
          const baseBranchName = await this.openaiManager.generateBranchName(task.description);
          const branchName = await this.gitManager.createAndCheckoutBranch(baseBranchName, taskId);
          
          this.db.updateTask(taskId, { branch_name: branchName });
          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: `Branch created: ${branchName}`
          });

          // Step 2: Generate code
          this.db.updateTask(taskId, { current_stage: 'generating_code' });
          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: `Calling ${task.coding_tool} to generate code...`
          });

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

          // Step 3: Run precommit checks
          this.db.updateTask(taskId, { current_stage: 'running_precommit_checks' });
          await this.runPrecommitChecks(taskId);

          // Step 4: Commit and push changes
          this.db.updateTask(taskId, { current_stage: 'committing_changes' });
          await this.gitManager.commitChangesWithTask(task.description, taskId);
          await this.gitManager.pushBranch(branchName, taskId);

          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: 'Changes committed and pushed'
          });

          // Step 5: Create PR
          this.db.updateTask(taskId, { current_stage: 'creating_pr' });
          if (this.prManager) {
            await this.createPR(taskId, task, branchName);
          } else {
            // No PR manager - mark as completed
            this.db.updateTask(taskId, { 
              status: 'completed',
              current_stage: 'completed',
              completed_at: new Date().toISOString()
            });
            this.emitTaskUpdate(taskId, 'completed');
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

  private async runPrecommitChecks(taskId: string): Promise<void> {
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

  private async createPR(taskId: string, task: Task, branchName: string): Promise<void> {
    if (!this.prManager) return;

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

  private async pollPRComments(taskId: string, prNumber: number): Promise<void> {
    if (!this.prManager) return;

    const task = this.db.getTask(taskId);
    if (!task || task.status !== 'awaiting-review') {
      return; // Task completed or cancelled
    }

    const githubUsername = this.db.getSetting('githubUsername')?.value;
    if (!githubUsername) return;

    try {
      // Get last processed comment ID
      const lastCommentSetting = this.db.getSetting(`last_comment_${taskId}`);
      const lastCommentId = lastCommentSetting ? parseInt(lastCommentSetting.value) : null;

      // Poll for new comments
      const newComments = await this.prManager.pollForComments(prNumber, lastCommentId, githubUsername);

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
      const pollInterval = parseInt(this.db.getSetting('poll_interval_seconds')?.value || '30') * 1000;
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

  private async handlePRComment(taskId: string, comment: string): Promise<void> {
    const task = this.db.getTask(taskId);
    if (!task) return;

    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: `Processing PR comment: ${comment.substring(0, 100)}...`
    });

    // Use task executor to ensure only one task operation at a time
    await taskExecutor.executeTask({
      taskId,
      operation: 'handle-pr-comment',
      execute: async () => {
        try {
          // Generate response/fixes based on comment
          const response = await this.codingManager.generateCode(
            task.coding_tool,
            `Original task: ${task.description}\n\nPR review comment: ${comment}\n\nPlease address this feedback.`,
            { taskId }
          );

          // Switch to task branch
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



  private emitTaskUpdate(taskId: string, status: TaskStatus, metadata?: any): void {
    const event: TaskUpdateEvent = {
      taskId,
      status,
      metadata
    };
    
    this.emit('task-update', event);
  }

  private startPRCommentPolling(): void {
    // Find all tasks that are awaiting review and start polling for them
    const awaitingTasks = this.db.getTasks({ status: 'awaiting-review' });
    
    for (const task of awaitingTasks) {
      if (task.pr_number) {
        this.jobQueue.enqueue('poll-pr-comments', { 
          taskId: task.id, 
          prNumber: task.pr_number 
        });
      }
    }
  }

  shutdown(): void {
    this.jobQueue.shutdown();
  }
}
