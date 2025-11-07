import { EventEmitter } from 'events';
import {
  Task,
  TaskStatus,
  TaskUpdateEvent,
  CreateTaskRequest,
  LogLevel,
} from '../types';
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
import { toMessage } from '../utils/error-utils';

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
      const githubProvider = this.getGitHubManager();
      return new GitManager(
        this.db,
        repositoryPath,
        this.openaiManager,
        this.settings,
        this.jiraManager,
        githubProvider
      );
    } catch (error: unknown) {
      const errorMsg = toMessage(error);
      logger.error(`Failed to initialize GitManager: ${errorMsg}`);
      throw new Error(`Git repository validation failed: ${errorMsg}`);
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
    } catch (error: unknown) {
      const errorMsg = `Failed to initialize GitHub CLI provider: ${toMessage(error)}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  private dbLog(taskId: number, level: LogLevel, message: string): void {
    this.db.addTaskLog({ task_id: taskId, level, message });
  }

  private setTaskStatus(
    taskId: number,
    status: TaskStatus,
    currentStage?: string,
    extra?: Partial<Task>
  ): void {
    this.db.updateTask(taskId, {
      status,
      current_stage: currentStage,
      ...extra,
    });
    this.emitTaskUpdate(taskId, status);
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
    } catch (error: unknown) {
      logger.warn(`Failed to generate task summary: ${toMessage(error)}`);
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

    this.dbLog(taskId, 'info', `Task created: ${request.title}`);
    this.emitTaskUpdate(taskId, 'pending');

    return taskId;
  }

  async cancelTask(taskId: number): Promise<void> {
    const task = this.db.getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    this.setTaskStatus(taskId, 'cancelled', 'cancelled', {
      completed_at: new Date().toISOString(),
    });

    this.dbLog(taskId, 'info', 'Task cancelled by user');
  }

  async watchTask(taskId: number): Promise<void> {
    const task = this.db.getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    if (!task.pr_url) {
      throw new Error('Can only watch tasks with a linked PR');
    }

    this.db.updateTask(taskId, {
      status: 'awaiting-review',
    });

    this.dbLog(
      taskId,
      'info',
      'Task moved to awaiting review for PR monitoring'
    );
  }

  async retryTask(taskId: number): Promise<void> {
    const task = this.db.getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    if (task.status !== 'failed' && task.status !== 'cancelled') {
      throw new Error('Can only retry failed or cancelled tasks');
    }

    // Check if this is a Jira ticket and refetch if needed
    if (this.jiraManager.isJiraTicket(task)) {
      const jiraKey = this.jiraManager.getJiraKey(task);
      if (jiraKey) {
        this.dbLog(
          taskId,
          'info',
          `Refetching Jira ticket ${jiraKey} before retry...`
        );

        try {
          const updatedTicket = await this.jiraManager.getTicketByKey(jiraKey);
          if (updatedTicket) {
            const updatedDescription = `Jira Ticket: ${updatedTicket.key}\nSummary: ${updatedTicket.summary}\n\n${updatedTicket.description}`;
            this.db.updateTask(taskId, {
              description: updatedDescription,
            });
            this.dbLog(
              taskId,
              'info',
              `Updated task with latest Jira ticket information. Status: ${updatedTicket.status}, Updated: ${updatedTicket.updated}`
            );
            logger.info(
              `Updated task ${taskId} with latest Jira ticket ${jiraKey} information`
            );
          } else {
            this.dbLog(
              taskId,
              'warn',
              `Could not refetch Jira ticket ${jiraKey} - proceeding with retry using existing information`
            );
          }
        } catch (error: unknown) {
          this.dbLog(
            taskId,
            'warn',
            `Failed to refetch Jira ticket ${jiraKey}: ${toMessage(error)} - proceeding with retry using existing information`
          );
        }
      }
    }

    // Reset task to pending state and clear completion timestamp
    this.setTaskStatus(taskId, 'pending', undefined, {
      completed_at: undefined,
    });

    this.dbLog(taskId, 'info', `Task retry requested (was ${task.status})`);

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
        await this.checkForNewPRs();
        await this.processReviews();
        await this.processPendingTasks();
      } catch (error: unknown) {
        logger.error(`Error in processing cycle: ${toMessage(error)}`);
      } finally {
        this.isProcessing = false;
      }
    }, 60000); // 1 minute
  }

  private async checkForNewPRs(): Promise<void> {
    if (!this.settings.get('autoWatchPRs')) {
      return;
    }

    try {
      const repositories = this.db.getRepositories();
      const githubProvider = this.getGitHubManager();

      for (const repo of repositories) {
        try {
          const openPRs = await githubProvider.getUserOpenPRs(repo.path);

          for (const pr of openPRs) {
            const existingTask = this.db
              .getTasks({})
              .find((t) => t.pr_url === pr.url);

            if (!existingTask) {
              const codingTool = this.settings.get('defaultCodingTool');
              const taskId = this.db.createTask({
                title: pr.title,
                summary: pr.title,
                description: pr.body || '',
                status: 'awaiting-review',
                coding_tool: codingTool,
                repository_path: repo.path,
                branch_name: pr.branchName,
                pr_url: pr.url,
                pr_number: pr.number,
              });

              this.dbLog(
                taskId,
                'info',
                `🔍 Auto-watching PR #${pr.number}: ${pr.title}`
              );

              logger.info(
                `Auto-created task ${taskId} for PR #${pr.number} in ${repo.name}`
              );
              this.emitTaskUpdate(taskId, 'awaiting-review');
            }
          }
        } catch (error: unknown) {
          logger.warn(
            `Failed to check PRs for ${repo.name}: ${toMessage(error)}`
          );
        }
      }
    } catch (error: unknown) {
      logger.warn(`Failed to check for new PRs: ${toMessage(error)}`);
    }
  }

  private async processPendingTasks(): Promise<void> {
    // Check for new Jira tasks first and get the task list
    try {
      await this.jiraManager.getLatestTasksForProcessing((request) =>
        this.createTask(request)
      );
    } catch (error: unknown) {
      logger.warn(`Failed to check for latest Jira tasks: ${toMessage(error)}`);
    }

    // Process pending and in_progress tasks (in case server was interrupted)
    const pendingTasks = this.db.getTasks({ status: 'pending' });
    const inProgressTasks = this.db.getTasks({ status: 'in-progress' });

    for (const task of [...pendingTasks, ...inProgressTasks]) {
      await this.processTask(task.id);
    }
  }

  private async processReviews(): Promise<void> {
    const awaitingReviewTasks = this.db.getTasks({ status: 'awaiting-review' });
    const addressingReviewTasks = this.db.getTasks({
      status: 'addressing-review',
    });

    // Single pass: for each task, check for new reviews, address them, and update status
    for (const task of [...awaitingReviewTasks, ...addressingReviewTasks]) {
      if (!task.pr_number || !task.branch_name) {
        continue;
      }

      try {
        const gitManager = this.getGitManager(task.repository_path);
        try {
          await gitManager.switchToBranch(task.branch_name, task.id);
        } catch (error: unknown) {
          const errorMessage = toMessage(error);
          this.dbLog(
            task.id,
            'error',
            `❌ Failed to switch to branch ${task.branch_name}: ${errorMessage}`
          );
          this.setTaskStatus(task.id, 'failed', 'failed');
          this.dbLog(
            task.id,
            'error',
            `💥 Task failed: Unable to switch to branch`
          );
          continue;
        }

        const result = await this.collectPRComments(task.id, task.pr_number);

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
          continue; // Skip comment processing if task is completed/cancelled
        }

        // If there are new comments, concatenate them and address all at once
        if (result.comments.length > 0) {
          const concatenatedComments = result.comments.join('\n\n---\n\n');

          this.dbLog(
            task.id,
            'info',
            `💬 Processing ${result.comments.length} PR review comment(s)...`
          );

          await this.handleAllPRComments(
            task.id,
            concatenatedComments,
            result.threadIds
          );
        }
      } catch (error: unknown) {
        this.dbLog(
          task.id,
          'error',
          `❌ Error processing reviews: ${toMessage(error)}`
        );
      }
    }
  }

  private async processTask(taskId: number): Promise<void> {
    logger.info(`Processing task: ${taskId}`);
    const task = this.db.getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    // Get git manager for the task's repository
    const gitManager = this.getGitManager(task.repository_path);

    // Use task executor to ensure only one task operation at a time
    await taskExecutor.executeTask({
      taskId: taskId,
      operation: 'process-task',
      execute: async () => {
        try {
          // Log which repository we're working on
          this.dbLog(
            taskId,
            'info',
            `🏠 Working on repository: ${task.repository_path}`
          );
          // Update status to in progress
          this.dbLog(
            taskId,
            'info',
            '🎯 Task started - transitioning to in-progress status'
          );
          this.setTaskStatus(taskId, 'in-progress', 'creating_branch');

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
              this.dbLog(taskId, 'info', `✅ Branch name generated: ${name}`);
              return name;
            }
          );

          const branchName = await withTaskLogMessages(
            this.db,
            {
              taskId,
              startMessage: '🔄 Creating and checking out branch...',
              completeMessage: `✅ Branch created and checked out`,
              failureMessage: '❌ Failed to create branch',
            },
            async () => {
              const name = await gitManager.createAndCheckoutBranch(
                generatedBranchName,
                taskId
              );
              this.db.updateTask(taskId, { branch_name: name });
              this.dbLog(
                taskId,
                'info',
                `✅ Branch created and checked out: ${name}`
              );
              // Emit update to notify UI of branch name
              this.emitTaskUpdate(taskId, 'in-progress');
              return name;
            }
          );

          // Step 2: Generate code
          this.setTaskStatus(taskId, 'in-progress', 'generating_code');

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
                { taskId, repositoryPath: task.repository_path }
              );

              // Log the actual output to task logs
              this.dbLog(
                taskId,
                'info',
                `📝 Code generation output:\n${output}`
              );
            }
          );

          // Step 3: Run precommit checks
          this.setTaskStatus(taskId, 'in-progress', 'running_precommit_checks');

          await withTaskLogMessages(
            this.db,
            {
              taskId,
              startMessage: '🔍 Starting precommit checks...',
              completeMessage: '✅ Precommit checks completed successfully',
              failureMessage: '❌ Precommit checks failed',
            },
            async () => {
              await this.runPrecommitChecks(taskId);
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
          this.dbLog(
            taskId,
            'info',
            '⏳ Waiting 10 seconds for GitHub to process the push...'
          );
          await new Promise((resolve) => setTimeout(resolve, 10000));

          // Step 5: Create PR
          this.setTaskStatus(taskId, 'in-progress', 'creating_pr');

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
        } catch (error: unknown) {
          this.dbLog(
            taskId,
            'error',
            '❌ Task failed - transitioning to failed status'
          );
          this.setTaskStatus(taskId, 'failed', 'failed');
          this.dbLog(taskId, 'error', `💥 Task failed: ${toMessage(error)}`);
          throw error;
        }
      },
    });
  }

  private async runPrecommitChecks(taskId: number): Promise<void> {
    const task = this.db.getTask(taskId);
    if (!task) throw new Error('Task not found');

    this.dbLog(taskId, 'info', '🧪 Running initial precommit checks...');

    await this.precommitManager.runChecks(taskId, task.repository_path);
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
    } catch (error: unknown) {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'error',
        message: `Failed to create PR: ${toMessage(error)}`,
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
    threadIds: string[];
    statusUpdate?: 'completed' | 'cancelled';
  }> {
    logger.info(`Collecting PR comments for task: ${taskId} ${prNumber}`);
    const task = this.db.getTask(taskId);
    if (!task) {
      return { comments: [], threadIds: [] };
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
          `Last commit timestamp for branch ${task.branch_name}: ${lastCommitTimestamp}`
        );
      } catch (error: unknown) {
        logger.warn(
          `Could not get last commit timestamp for branch ${task.branch_name}:`,
          toMessage(error)
        );
      }
    }

    // Poll for unresolved comments
    // Review comments: filtered by resolved status
    // General PR comments: filtered by timestamp
    const { comments, threadIds } = await githubManager.pollForComments(
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

    return { comments, threadIds, statusUpdate };
  }

  private async handleAllPRComments(
    taskId: number,
    concatenatedComments: string,
    threadIds: string[]
  ): Promise<void> {
    logger.info(`Handling concatenated PR comments for task: ${taskId}`);
    const task = this.db.getTask(taskId);
    if (!task) return;

    // Use task executor to ensure only one task operation at a time
    await taskExecutor.executeTask({
      taskId: taskId,
      operation: 'handle-pr-comments',
      execute: async () => {
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

        // Switch to the task branch before generating fixes (also pulls latest and discards local changes)
        if (task.branch_name) {
          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: `🔄 Switching to branch: ${task.branch_name}`,
          });
          const gitManager = this.getGitManager(task.repository_path);
          await gitManager.switchToBranch(task.branch_name, taskId);
        }

        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: '🛠️ Generating fixes for all PR review comments...',
        });

        // Generate response/fixes based on all comments at once
        const output = await this.codingManager.generateCode(
          task.coding_tool,
          `Original task: ${task.description}\n\nPR review comments to address:\n\n${concatenatedComments}\n\nAddress all the feedback above. Make all necessary code changes based on the review comments. Do not ask for clarification - analyze the available context and make the best decisions to resolve each comment. If a comment is ambiguous, choose the most logical interpretation based on the codebase patterns and the original task requirements.`,
          { taskId, repositoryPath: task.repository_path }
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
        await this.runPrecommitChecks(taskId);

        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: '📝 Committing and pushing fixes...',
        });

        // Commit and push changes
        const gitManager = this.getGitManager(task.repository_path);
        await gitManager.commitChanges(`Address PR feedback`, taskId);
        if (task.branch_name) {
          await gitManager.pushBranch(task.branch_name, taskId);
        }

        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: '✅ All PR feedback addressed and changes pushed',
        });

        // Mark the review threads as resolved
        const githubManager = this.getGitHubManager();
        await githubManager.resolveThreadsByIds(
          threadIds,
          task.repository_path,
          taskId
        );

        // Update status back to awaiting-review
        this.db.updateTask(taskId, {
          status: 'awaiting-review',
          current_stage: 'awaiting_review',
        });
        this.emitTaskUpdate(taskId, 'awaiting-review');
      },
    });
  }

  private emitTaskUpdate(
    taskId: number,
    status: TaskStatus,
    metadata?: Record<string, unknown>
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
