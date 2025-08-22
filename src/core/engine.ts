import { EventEmitter } from 'events';
import { Task, TaskStatus, TaskUpdateEvent, CreateTaskRequest } from '../types';
import { taskExecutor } from './task-executor';
import { logger } from '../utils/logger';
import { withTaskLogMessages } from '../utils/task-logging';
import { DatabaseManager } from './database';
import { SettingsManager } from './settings-manager';
import { CodingManager } from './coding-manager';
import { PrecommitManager } from './precommit-manager';
import { OpenAIManager } from './openai-manager';
import { GitManager } from './git-manager';
import { GitHubCLIProvider } from './github-cli-provider';
import { JiraManager } from './jira-manager';

export class CoreEngine extends EventEmitter {
  private db: DatabaseManager;
  private settings: SettingsManager;
  private codingManager: CodingManager;
  private precommitManager: PrecommitManager;
  private githubManager?: GitHubCLIProvider;
  private openaiManager: OpenAIManager;
  private jiraManager: JiraManager;
  private isInitialized = false;
  private processingInterval?: NodeJS.Timeout;
  private isProcessing = false;

  constructor(
    db: DatabaseManager,
    settings: SettingsManager,
    codingManager: CodingManager,
    precommitManager: PrecommitManager,
    openaiManager: OpenAIManager,
    jiraManager: JiraManager
  ) {
    super();
    this.db = db;
    this.settings = settings;
    this.codingManager = codingManager;
    this.precommitManager = precommitManager;
    this.openaiManager = openaiManager;
    this.jiraManager = jiraManager;
  }

  private getGitManager(repositoryPath: string): GitManager {
    try {
      return new GitManager(
        this.db,
        repositoryPath,
        this.openaiManager,
        this.settings,
        this.jiraManager
      );
    } catch (error: any) {
      logger.error(`Failed to initialize GitManager: ${error.message}`);
      throw new Error(`Git repository validation failed: ${error.message}`);
    }
  }

  private getGitHubManager(): GitHubCLIProvider {
    if (this.githubManager) {
      return this.githubManager;
    }

    try {
      this.githubManager = new GitHubCLIProvider(
        this.db,
        this.openaiManager,
        this.settings,
        this.jiraManager
      );
      return this.githubManager;
    } catch (error) {
      const errorMsg = `Failed to initialize GitHub CLI provider: ${error}`;
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
      summary = await this.openaiManager.generateTaskSummary(
        request.description
      );
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
      coding_tool: request.codingTool,
      repository_path: request.repositoryPath,
    };

    // Store task in database - returns auto-generated ID
    const taskId = this.db.createTask(task);
    logger.info(`Task created: ${request.title} ${taskId.toString()}`);

    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: `Task created: ${request.title}`,
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
      completed_at: new Date().toISOString(),
    });

    const gitManager = this.getGitManager(task.repository_path);
    await gitManager.releaseWorktree(taskId);

    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: 'Task cancelled by user',
    });

    this.emitTaskUpdate(taskId, 'cancelled');
  }

  async retryTask(taskId: number): Promise<void> {
    const task = this.db.getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    if (task.status !== 'failed' && task.status !== 'cancelled') {
      throw new Error('Can only retry failed or cancelled tasks');
    }

    // Reset task to pending state and clear completion timestamp
    this.db.updateTask(taskId, {
      status: 'pending',
      current_stage: undefined,
      completed_at: undefined,
    });

    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: `Task retry requested (was ${task.status})`,
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
        const reviewPromises = await this.processReviews();
        const taskPromises = await this.processPendingTasks();
        // Execute all promises in parallel
        await Promise.all([...reviewPromises, ...taskPromises]);
      } catch (error) {
        logger.error(`Error in processing cycle: ${error}`);
      } finally {
        this.isProcessing = false;
      }
    }, 60000); // 1 minute
  }

  private async processPendingTasks(): Promise<Promise<void>[]> {
    // Check for new Jira tasks first and get the task list
    try {
      await this.jiraManager.getLatestTasksForProcessing((request) =>
        this.createTask(request)
      );
    } catch (error) {
      logger.warn(`Failed to check for latest Jira tasks: ${error}`);
    }

    // Process pending and in_progress tasks (in case server was interrupted)
    const pendingTasks = this.db.getTasks({ status: 'pending' });
    const inProgressTasks = this.db.getTasks({ status: 'in-progress' });
    const awaitingReviewTasks = this.db.getTasks({ status: 'awaiting-review' });

    const promises: Promise<void>[] = [];
    for (const task of [
      ...pendingTasks,
      ...inProgressTasks,
      ...awaitingReviewTasks,
    ]) {
      promises.push(this.processTask(task.id));
    }

    return promises;
  }

  private async processReviews(): Promise<Promise<void>[]> {
    const awaitingReviewTasks = this.db.getTasks({ status: 'awaiting-review' });
    const promises: Promise<void>[] = [];

    // Single pass: for each task, check for new reviews, address them, and update status
    for (const task of [...awaitingReviewTasks]) {
      if (!task.pr_number || !task.branch_name) {
        continue;
      }

      // Create a promise for each task review processing
      const promise = (async () => {
        const gitManager = this.getGitManager(task.repository_path);
        const workingDirectory = await gitManager.acquireWorktreeForTask(
          task.id
        );
        if (!workingDirectory) {
          // No worktree available, skip this task for now and retry in next cycle
          return;
        }

        try {
          await gitManager.switchToBranch(task.branch_name!, task.id);
          const result = await this.collectPRComments(task.id, task.pr_number!);

          // Handle status updates first (completed/cancelled)
          if (result.statusUpdate) {
            if (result.statusUpdate === 'completed') {
              this.db.updateTask(task.id, {
                status: 'completed',
                current_stage: 'completed',
                completed_at: new Date().toISOString(),
              });
              this.emitTaskUpdate(task.id, 'completed');
            } else if (result.statusUpdate === 'cancelled') {
              this.db.updateTask(task.id, {
                status: 'cancelled',
                current_stage: 'cancelled',
              });
              this.emitTaskUpdate(task.id, 'cancelled');
            }
            return; // Skip comment processing if task is completed/cancelled
          }

          // If there are new comments, concatenate them and address all at once
          if (result.comments.length > 0) {
            const concatenatedComments = result.comments.join('\n\n---\n\n');

            this.db.addTaskLog({
              task_id: task.id,
              level: 'info',
              message: `💬 Processing ${result.comments.length} PR review comment(s)...`,
            });

            await this.handleAllPRComments(task.id, concatenatedComments);
          }
        } catch (error: any) {
          this.db.addTaskLog({
            task_id: task.id,
            level: 'error',
            message: `❌ Error processing reviews: ${error.message}`,
          });
        } finally {
          await gitManager.releaseWorktree(task.id);
        }
      })();

      promises.push(promise);
    }

    return promises;
  }

  private async processTask(taskId: number): Promise<void> {
    logger.info(`Processing task: ${taskId}`);
    const task = this.db.getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    const gitManager = this.getGitManager(task.repository_path);
    const workingDirectory = await gitManager.acquireWorktreeForTask(taskId);
    if (!workingDirectory) {
      return;
    }

    // Use task executor to ensure only one task operation at a time
    await taskExecutor.executeTask({
      taskId: taskId,
      operation: 'process-task',
      execute: async () => {
        try {
          // Log which repository we're working on
          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: `🏠 Working on repository: ${task.repository_path}, worktree: ${workingDirectory}`,
          });
          // Update status to in progress
          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: '🎯 Task started - transitioning to in-progress status',
          });
          this.db.updateTask(taskId, {
            status: 'in-progress',
            current_stage: 'creating_branch',
          });
          this.emitTaskUpdate(taskId, 'in-progress');

          // Step 1: Create branch
          const generatedBranchName = await withTaskLogMessages(
            this.db,
            {
              taskId,
              startMessage: '🌿 Generating branch name...',
              completeMessage: `✅ Branch name generation completed`,
              failureMessage: '❌ Failed to generate branch name',
            },
            async () => {
              const name = await this.openaiManager.generateBranchName(
                task.description,
                taskId
              );
              // Update the completion message with the actual name
              this.db.addTaskLog({
                task_id: taskId,
                level: 'info',
                message: `✅ Branch name generated: ${name}`,
              });
              return name;
            }
          );

          const branchName = await gitManager.createAndCheckoutBranch(
            generatedBranchName,
            taskId
          );

          this.db.updateTask(taskId, { branch_name: branchName });
          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: `✅ Branch created and checked out: ${branchName}`,
          });
          // Emit update to notify UI of branch name
          this.emitTaskUpdate(taskId, 'in-progress');

          // Step 2: Generate code
          this.db.updateTask(taskId, { current_stage: 'generating_code' });
          this.emitTaskUpdate(taskId, 'in-progress');

          await withTaskLogMessages(
            this.db,
            {
              taskId,
              startMessage: `💻 Starting code generation with ${task.coding_tool}...`,
              completeMessage: '✅ Code generation completed successfully',
              failureMessage: '❌ Code generation failed',
            },
            async () => {
              const output = await this.codingManager.generateCode(
                task.coding_tool,
                task.description,
                { taskId, repositoryPath: workingDirectory }
              );

              // Log the actual output to task logs
              this.db.addTaskLog({
                task_id: taskId,
                level: 'info',
                message: `📝 Code generation output:\n${output}`,
              });
            }
          );

          // Step 3: Run precommit checks
          this.db.updateTask(taskId, {
            current_stage: 'running_precommit_checks',
          });
          this.emitTaskUpdate(taskId, 'in-progress');

          await withTaskLogMessages(
            this.db,
            {
              taskId,
              startMessage: '🔍 Starting precommit checks...',
              completeMessage: '✅ Precommit checks completed successfully',
              failureMessage: '❌ Precommit checks failed',
            },
            async () => {
              await this.runPrecommitChecks(taskId, workingDirectory);
            }
          );

          // Step 4: Commit and push changes
          this.db.updateTask(taskId, { current_stage: 'committing_changes' });
          this.emitTaskUpdate(taskId, 'in-progress');

          await withTaskLogMessages(
            this.db,
            {
              taskId,
              startMessage: '📝 Committing changes...',
              completeMessage: '✅ Changes committed successfully',
              failureMessage: '❌ Failed to commit changes',
            },
            async () => {
              await gitManager.commitChanges(task.description, taskId);
            }
          );

          await withTaskLogMessages(
            this.db,
            {
              taskId,
              startMessage: '🚀 Pushing branch to remote...',
              completeMessage: '✅ Branch pushed to remote successfully',
              failureMessage: '❌ Failed to push branch',
            },
            async () => {
              await gitManager.pushBranch(branchName, taskId);
            }
          );

          // Wait for GitHub to process the push
          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: '⏳ Waiting 10 seconds for GitHub to process the push...',
          });
          await new Promise((resolve) => setTimeout(resolve, 10000));

          // Step 5: Create PR
          this.db.updateTask(taskId, { current_stage: 'creating_pr' });
          this.emitTaskUpdate(taskId, 'in-progress');

          await withTaskLogMessages(
            this.db,
            {
              taskId,
              startMessage: '🔄 Creating pull request...',
              completeMessage: '✅ Pull request created successfully',
              failureMessage: '❌ Failed to create PR',
            },
            async () => {
              await this.createPR(taskId, task, branchName);
            }
          );
        } catch (error: any) {
          this.db.addTaskLog({
            task_id: taskId,
            level: 'error',
            message: '❌ Task failed - transitioning to failed status',
          });
          this.db.updateTask(taskId, {
            status: 'failed',
            current_stage: 'failed',
          });
          this.db.addTaskLog({
            task_id: taskId,
            level: 'error',
            message: `💥 Task failed: ${error.message}`,
          });
          this.emitTaskUpdate(taskId, 'failed');
          throw error;
        } finally {
          await gitManager.releaseWorktree(taskId);
        }
      },
    });
  }

  private async runPrecommitChecks(
    taskId: number,
    workingDirectory: string
  ): Promise<void> {
    const task = this.db.getTask(taskId);
    if (!task) throw new Error('Task not found');

    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message: '🧪 Running initial precommit checks...',
    });

    await this.precommitManager.runChecks(taskId, workingDirectory);
  }

  private async createPR(
    taskId: number,
    task: Task,
    branchName: string
  ): Promise<void> {
    try {
      const githubManager = this.getGitHubManager();
      const pr = await githubManager.createPRFromTask(
        branchName,
        task,
        task.repository_path
      );

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message:
          '🎉 Task processing completed successfully - transitioning to awaiting-review',
      });

      this.db.updateTask(taskId, {
        status: 'awaiting-review',
        current_stage: 'awaiting_review',
        pr_number: pr.number,
        pr_url: pr.url,
      });

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🔗 PR created: ${pr.url}`,
      });

      this.emitTaskUpdate(taskId, 'awaiting-review');

      // PR comments will be polled by periodic processing
    } catch (error) {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'error',
        message: `Failed to create PR: ${error}`,
      });
      // Update task to failed since we can't create PR
      this.db.updateTask(taskId, {
        status: 'failed',
        current_stage: 'failed',
      });
      this.emitTaskUpdate(taskId, 'failed');
    }
  }

  private async collectPRComments(
    taskId: number,
    prNumber: number
  ): Promise<{
    comments: string[];
    statusUpdate?: 'completed' | 'cancelled';
  }> {
    logger.info(`Collecting PR comments for task: ${taskId} ${prNumber}`);
    const task = this.db.getTask(taskId);
    if (!task || task.status !== 'awaiting-review') {
      return { comments: [] }; // Task completed or cancelled
    }

    const githubManager = this.getGitHubManager();

    // Get last commit timestamp for the branch
    let lastCommitTimestamp: string | null = null;
    if (task.branch_name) {
      try {
        const gitManager = this.getGitManager(task.repository_path);
        lastCommitTimestamp = await gitManager.getLastCommitTimestamp(
          task.branch_name
        );
        logger.info(
          `last commit timestamp for branch ${task.branch_name}: ${lastCommitTimestamp}`
        );
      } catch (error) {
        // If we can't get commit timestamp, continue with null (will get all comments)
        console.warn(
          `Could not get last commit timestamp for branch ${task.branch_name}:`,
          error
        );
      }
    }

    // Poll for new comments since last commit
    const newComments = await githubManager.pollForComments(
      prNumber,
      lastCommitTimestamp,
      task.repository_path
    );

    // Check PR status
    const prStatus = await githubManager.getPRStatus(
      prNumber,
      task.repository_path
    );
    let statusUpdate: 'completed' | 'cancelled' | undefined;

    if (prStatus.merged) {
      statusUpdate = 'completed';
    } else if (prStatus.state === 'CLOSED') {
      statusUpdate = 'cancelled';
    }

    return { comments: newComments, statusUpdate };
  }

  private async handleAllPRComments(
    taskId: number,
    concatenatedComments: string
  ): Promise<void> {
    logger.info(`Handling concatenated PR comments for task: ${taskId}`);
    const task = this.db.getTask(taskId);
    if (!task) return;

    // Use task executor to ensure only one task operation at a time
    await taskExecutor.executeTask({
      taskId: taskId,
      operation: 'handle-pr-comments',
      execute: async () => {
        try {
          const gitManager = this.getGitManager(task.repository_path);
          const workingDirectory = gitManager.getWorkingDirectory(taskId);

          // Update status to addressing-review
          this.db.updateTask(taskId, {
            status: 'addressing-review',
            current_stage: 'addressing_review',
          });
          this.emitTaskUpdate(taskId, 'addressing-review');

          // Log the review comments first
          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: `💬 PR review comments received:\n${concatenatedComments}`,
          });

          // Switch to the task branch before generating fixes
          if (!task.branch_name) {
            throw new Error(`Branch name not found for task ${taskId}`);
          }
          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: `🔄 Switching to branch: ${task.branch_name}`,
          });

          await gitManager.switchToBranch(task.branch_name, taskId);

          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: '🛠️ Generating fixes for all PR review comments...',
          });

          // Generate response/fixes based on all comments at once
          const output = await this.codingManager.generateCode(
            task.coding_tool,
            `Original task: ${task.description}\n\nPR review comments to address:\n\n${concatenatedComments}\n\nAddress all the feedback above. Make all necessary code changes based on the review comments. Do not ask for clarification - analyze the available context and make the best decisions to resolve each comment. If a comment is ambiguous, choose the most logical interpretation based on the codebase patterns and the original task requirements.`,
            { taskId, repositoryPath: workingDirectory }
          );

          // Log the code generation output
          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: `📝 Review fix output:\n${output}`,
          });

          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: '✅ Code changes generated, running precommit checks...',
          });

          // Apply changes and run checks
          await this.runPrecommitChecks(taskId, workingDirectory);

          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: '📝 Committing and pushing fixes...',
          });

          // Commit and push changes
          await gitManager.commitChanges(`Address PR feedback`, taskId);
          if (task.branch_name) {
            await gitManager.pushBranch(task.branch_name, taskId);
          }

          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: '✅ All PR feedback addressed and changes pushed',
          });

          // Update status back to awaiting-review
          this.db.updateTask(taskId, {
            status: 'awaiting-review',
            current_stage: 'awaiting_review',
          });
          this.emitTaskUpdate(taskId, 'awaiting-review');
        } catch (error: any) {
          this.db.addTaskLog({
            task_id: taskId,
            level: 'error',
            message: `❌ Error handling PR comments: ${error.message}`,
          });
          throw error;
        }
      },
    });
  }

  private emitTaskUpdate(
    taskId: number,
    status: TaskStatus,
    metadata?: any
  ): void {
    // Get the full task data to include in the update
    const task = this.db.getTask(taskId);

    const event: TaskUpdateEvent = {
      taskId,
      status,
      metadata: {
        ...metadata,
        task: task, // Include full task data
      },
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
