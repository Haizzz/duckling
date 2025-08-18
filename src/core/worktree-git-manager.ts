import { simpleGit, SimpleGit } from 'simple-git';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';
import { DatabaseManager } from './database';
import { SettingsManager } from './settings-manager';
import { OpenAIManager } from './openai-manager';
import { JiraManager } from './jira-manager';
import { WorktreeManager } from './worktree-manager';
import { GitHubCLIProvider } from './github-cli-provider';

export class WorktreeGitManager {
  private git: SimpleGit;
  private db: DatabaseManager;
  private settings: SettingsManager;
  private openaiManager: OpenAIManager;
  private jiraManager: JiraManager;
  private worktreePath: string;
  private mainRepoPath: string;

  constructor(
    db: DatabaseManager,
    mainRepoPath: string,
    worktreePath: string,
    openaiManager: OpenAIManager,
    settings: SettingsManager,
    jiraManager: JiraManager
  ) {
    this.db = db;
    this.settings = settings;
    this.openaiManager = openaiManager;
    this.jiraManager = jiraManager;
    this.worktreePath = worktreePath;
    this.mainRepoPath = mainRepoPath;
    this.git = simpleGit(worktreePath);
  }

  async getLastCommitTimestamp(branchName: string): Promise<string> {
    return await withRetry(
      async () => {
        logger.info(`Getting last commit timestamp for branch: ${branchName}`);
        const log = await this.git.log(['-1', '--format=%cI']);

        if (log.latest) {
          return log.latest.hash;
        }

        throw new Error(`No commits found for branch ${branchName}`);
      },
      'Get last commit timestamp',
      2
    );
  }

  async createAndCheckoutBranch(
    generatedBranchName: string,
    taskId: number
  ): Promise<string> {
    return await withRetry(async () => {
      const branchPrefix = this.settings.get('branchPrefix');
      const githubManager = new GitHubCLIProvider(
        this.db,
        this.openaiManager,
        this.settings,
        this.jiraManager
      );
      const defaultBranch = await githubManager.getDefaultBranch(
        this.mainRepoPath
      );

      logger.info(
        `Creating new branch in worktree: ${this.worktreePath}`,
        taskId.toString()
      );

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `📥 Fetching latest changes from ${defaultBranch}...`,
      });

      // First, get latest changes for the default branch
      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🔄 Switching to ${defaultBranch} and pulling latest...`,
      });

      // Switch to default branch and get latest
      await this.git.checkout(defaultBranch);
      await this.git.fetch('origin', defaultBranch);
      await this.git.reset(['--hard', `origin/${defaultBranch}`]);

      // Generate unique branch name
      let branchName = `${branchPrefix}${generatedBranchName}`;
      let counter = 1;

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🔍 Checking if branch name '${branchName}' is available...`,
      });

      // Use main repo's git to check for existing branches
      const mainGit = simpleGit(this.mainRepoPath);
      while (await this.branchExists(branchName, mainGit)) {
        branchName = `${branchPrefix}${generatedBranchName}-${counter}`;
        counter++;
      }

      if (counter > 1) {
        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: `ℹ️ Branch name adjusted to avoid conflicts: ${branchName}`,
        });
      }

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🌱 Creating and checking out new branch: ${branchName}`,
      });

      // Create and checkout the new branch
      await this.git.checkoutLocalBranch(branchName);

      // Update the worktree manager with branch info
      const worktreeManager = WorktreeManager.getInstance();
      const worktreeId = this.worktreePath.split('/').pop() || 'unknown';
      worktreeManager.updateWorktreeBranch(worktreeId, branchName);

      logger.info(
        `Created and switched to branch: ${branchName} in worktree: ${this.worktreePath}`,
        taskId.toString()
      );
      return branchName;
    }, 'Create and checkout branch in worktree');
  }

  private async branchExists(
    branchName: string,
    git: SimpleGit
  ): Promise<boolean> {
    try {
      const branches = await git.branchLocal();
      return branches.all.includes(branchName);
    } catch (error) {
      return false;
    }
  }

  async commitChanges(taskDescription: string, taskId: number): Promise<void> {
    return await withRetry(async () => {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: '📁 Adding all changes to staging area...',
      });

      // Add all changes
      await this.git.add('.');

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: '🔍 Checking for changes to commit...',
      });

      // Check if there are changes to commit
      const status = await this.git.status();
      if (status.files.length === 0) {
        this.db.addTaskLog({
          task_id: taskId,
          level: 'error',
          message: '❌ No changes to commit found',
        });
        throw new Error('No changes to commit');
      }

      // Get list of changed files for context
      const changedFiles = [
        ...status.modified,
        ...status.created,
        ...status.deleted,
      ];

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `📝 Found ${changedFiles.length} changed files, generating commit message...`,
      });

      // Generate intelligent commit message
      const message = await this.openaiManager.generateCommitMessage(
        taskDescription,
        changedFiles,
        taskId
      );

      // Apply commit suffix from settings
      const suffix = this.settings.get('commitSuffix');
      const finalMessage = message.endsWith(suffix)
        ? message
        : `${message}${suffix}`;

      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `💾 Committing with message: "${finalMessage}"`,
      });

      // Commit changes
      await this.git.commit(finalMessage);

      logger.info(`Committed changes: ${finalMessage}`, taskId.toString());
    }, 'Commit changes in worktree');
  }

  async pushBranch(branchName: string, taskId: number): Promise<void> {
    return await withRetry(async () => {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🚀 Pushing branch '${branchName}' to origin from worktree...`,
      });

      await this.git.push('origin', branchName);
      logger.info(
        `Pushed branch: ${branchName} from worktree: ${this.worktreePath}`,
        taskId.toString()
      );
    }, 'Push branch from worktree');
  }

  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current || 'main';
  }

  async switchToBranch(branchName: string, taskId?: number): Promise<void> {
    return await withRetry(async () => {
      if (taskId)
        logger.info(
          `Fetching and switching to branch: ${branchName} in worktree: ${this.worktreePath}`,
          taskId.toString()
        );

      // Fetch the specific branch first to ensure we have latest changes
      await this.git.fetch('origin', branchName);

      // Reset hard to origin branch to discard any local changes
      await this.git.reset(['--hard', `origin/${branchName}`]);
      await this.git.clean('f', ['-d']);

      // Switch to the branch
      await this.git.checkout(branchName);

      // Update the worktree manager with branch info
      const worktreeManager = WorktreeManager.getInstance();
      const worktreeId = this.worktreePath.split('/').pop() || 'unknown';
      worktreeManager.updateWorktreeBranch(worktreeId, branchName);
    }, 'Switch to branch in worktree');
  }

  async fetchBranch(branchName: string, taskId?: number): Promise<void> {
    return await withRetry(async () => {
      if (taskId)
        logger.info(
          `Fetching latest changes for branch: ${branchName} in worktree: ${this.worktreePath}`,
          taskId.toString()
        );
      await this.git.fetch('origin', branchName);
    }, `Fetch branch ${branchName} in worktree`);
  }

  async getChangedFiles(): Promise<string[]> {
    const status = await this.git.status();
    return [
      ...status.created,
      ...status.modified,
      ...status.deleted,
      ...status.renamed.map((r) => r.to || r.from),
    ];
  }

  async getDiff(branchName?: string): Promise<string> {
    if (branchName) {
      return await this.git.diff([`origin/main...${branchName}`]);
    } else {
      return await this.git.diff();
    }
  }

  async pullLatest(
    branchName: string = 'main',
    taskId?: number
  ): Promise<void> {
    return await withRetry(async () => {
      // Hard pull: fetch and reset to origin state to override any local changes
      await this.git.fetch('origin', branchName);
      await this.git.reset(['--hard', `origin/${branchName}`]);
      if (taskId)
        logger.info(
          `Hard pulled latest changes from ${branchName} in worktree: ${this.worktreePath}`,
          taskId.toString()
        );
    }, 'Hard pull latest changes in worktree');
  }

  getWorktreePath(): string {
    return this.worktreePath;
  }

  getMainRepoPath(): string {
    return this.mainRepoPath;
  }
}
