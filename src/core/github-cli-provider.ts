/**
 * GitHub CLI Provider - Implements GitHub operations using GitHub CLI
 */

import { executeGitHubCLI } from '../utils/github-cli-utils';
import { validateAndGetRepoInfo } from '../utils/git-utils';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';
import { execCommand } from '../utils/exec';
import { processAllComments, CommentData } from '../utils/comment-processor';
import { DatabaseManager } from './database';
import { OpenAIManager } from './openai-manager';
import { SettingsManager } from './settings-manager';
import { JiraManager } from './jira-manager';
import { Task } from '../types';

interface GitHubUser {
  login: string;
}

interface GitHubComment {
  id: number;
  user: GitHubUser;
  body: string;
  created_at: string;
  path?: string;
  line?: number;
  diff_hunk?: string;
}

interface ReviewThreadComment {
  id: string;
  databaseId: number;
  body: string;
  author: { login: string };
  createdAt: string;
  path?: string;
  line?: number;
  diffHunk?: string;
}

interface ReviewThread {
  id: string;
  isResolved: boolean;
  comments: {
    nodes: ReviewThreadComment[];
  };
}

interface GitHubReviewBody {
  id: string;
  databaseId: number;
  body: string;
  state: string;
  author: { login: string };
  createdAt: string;
}

export class GitHubCLIProvider {
  private db: DatabaseManager;
  private openaiManager: OpenAIManager;
  private settings: SettingsManager;
  private jiraManager: JiraManager;
  private repoOwner: string = '';
  private repoName: string = '';
  private currentRepoPath: string = '';

  constructor(
    db: DatabaseManager,
    openaiManager: OpenAIManager,
    settings: SettingsManager,
    jiraManager: JiraManager
  ) {
    this.db = db;
    this.openaiManager = openaiManager;
    this.settings = settings;
    this.jiraManager = jiraManager;
  }

  private async ensureInitialized(repositoryPath: string) {
    // Re-initialize if repository path has changed
    if (this.currentRepoPath === repositoryPath) return;

    try {
      const repoInfo = await validateAndGetRepoInfo(repositoryPath);
      this.repoOwner = repoInfo.owner;
      this.repoName = repoInfo.name;
      this.currentRepoPath = repositoryPath;
    } catch (error) {
      throw new Error(`Failed to get repository information: ${error}`);
    }
  }

  async getDefaultBranch(repositoryPath: string): Promise<string> {
    await this.ensureInitialized(repositoryPath);

    return await withRetry(async () => {
      try {
        const result = await execCommand(
          'gh',
          ['repo', 'view', '--json', 'defaultBranchRef'],
          { cwd: repositoryPath }
        );
        if (result.exitCode !== 0) {
          throw new Error(`GitHub CLI command failed: ${result.stderr}`);
        }
        const data = JSON.parse(result.stdout);
        return data.defaultBranchRef.name;
      } catch (error) {
        logger.warn(
          'Could not get default branch from GitHub CLI, falling back to "main"',
          String(error)
        );
        return 'main';
      }
    }, 'Get default branch from GitHub CLI');
  }

  async createPRFromTask(
    branchName: string,
    task: Task,
    repositoryPath: string
  ): Promise<{ number: number; url: string }> {
    await this.ensureInitialized(repositoryPath);

    this.db.addTaskLog({
      task_id: task.id,
      level: 'info',
      message: '🤖 Generating PR title and description...',
    });

    // Get recent PRs as examples
    const recentPRs = await this.getRecentUserPRs(repositoryPath);

    // Get current PR diff for context
    const prDiff = await this.getBranchDiff(branchName, repositoryPath);

    // Generate intelligent title and description using OpenAI with examples
    const title = await this.openaiManager.generatePRTitle(
      task,
      recentPRs,
      prDiff,
      this.jiraManager
    );
    const description = await this.openaiManager.generatePRDescription(
      task.description,
      branchName,
      recentPRs,
      prDiff
    );

    this.db.addTaskLog({
      task_id: task.id,
      level: 'info',
      message: `📋 Generated PR title: "${title}"`,
    });

    return this.createPR(
      branchName,
      title,
      description,
      task.id,
      repositoryPath
    );
  }

  async createPR(
    branchName: string,
    title: string,
    description: string,
    taskId: number,
    repositoryPath: string
  ): Promise<{ number: number; url: string }> {
    await this.ensureInitialized(repositoryPath);

    return await withRetry(
      async () => {
        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: `🔍 Checking if PR already exists for branch: ${branchName}`,
        });

        // Check if PR already exists for this branch
        const existingPR = await this.findPRByBranch(
          branchName,
          repositoryPath
        );
        if (existingPR) {
          this.db.addTaskLog({
            task_id: taskId,
            level: 'info',
            message: `✅ Found existing PR #${existingPR.number}: ${existingPR.url}`,
          });
          return {
            number: existingPR.number,
            url: existingPR.url,
          };
        }

        // Get the default branch
        const defaultBranch = await this.getDefaultBranch(repositoryPath);

        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: `🚀 Creating new PR from ${branchName} to ${defaultBranch}...`,
        });

        // Create new PR using GitHub CLI
        const result = await execCommand(
          'gh',
          [
            'pr',
            'create',
            '--title',
            title,
            '--body',
            description,
            '--head',
            branchName,
            '--base',
            defaultBranch,
          ],
          { cwd: repositoryPath }
        );
        if (result.exitCode !== 0) {
          throw new Error(`GitHub CLI command failed: ${result.stderr}`);
        }

        // Parse the PR URL from the output
        const prUrl = result.stdout.trim();
        const prNumber = parseInt(prUrl.split('/').pop() || '0');

        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: `✅ PR created successfully: #${prNumber} - ${prUrl}`,
        });

        this.logPREvent(taskId, `PR created: #${prNumber}`);

        return {
          number: prNumber,
          url: prUrl,
        };
      },
      'Create PR via GitHub CLI',
      3
    );
  }

  async findPRByBranch(
    branchName: string,
    repositoryPath?: string
  ): Promise<{ number: number; url: string; title: string } | null> {
    if (repositoryPath) {
      await this.ensureInitialized(repositoryPath);
    }
    try {
      const result = repositoryPath
        ? await execCommand(
            'gh',
            [
              'pr',
              'list',
              '--head',
              branchName,
              '--json',
              'number,url,title',
              '--state',
              'open',
            ],
            { cwd: repositoryPath }
          )
        : await executeGitHubCLI(
            `pr list --head ${branchName} --repo ${this.repoOwner}/${this.repoName} --json number,url,title --state open`
          );

      if (repositoryPath && 'exitCode' in result && result.exitCode !== 0) {
        throw new Error(`GitHub CLI command failed: ${result.stderr}`);
      }

      const prs = JSON.parse(result.stdout);
      return prs.length > 0 ? prs[0] : null;
    } catch (error) {
      logger.debug('Failed to find PR by branch:', String(error));
      return null;
    }
  }

  async pollForComments(
    prNumber: number,
    lastCommitTimestamp: string | null,
    repositoryPath: string
  ): Promise<{
    comments: string[];
    threadIds: string[];
  }> {
    try {
      const commentPrefix = this.settings.get('commentPrefix');
      const skipUsernameCheck = this.settings.get('skipUsernameCheck');

      // Get current user to filter out their own comments
      const currentUser = await this.getCurrentUser(repositoryPath);

      // Get unresolved review threads from GraphQL
      const { reviewThreads, reviewBodies } =
        await this.getUnresolvedReviewThreads(prNumber, repositoryPath);
      const reviewCommentData: CommentData[] = [
        // Add review bodies (overall review summaries) - these don't have threads
        ...reviewBodies
          .filter((review) => review.body && review.body.trim())
          .map((review) => ({
            id: review.databaseId,
            user: { login: review.author.login },
            body: review.body,
            created_at: review.createdAt,
          })),
        // Add line-level comments from threads
        ...reviewThreads.flatMap((thread) =>
          thread.comments.nodes.map((comment) => ({
            id: comment.databaseId,
            user: { login: comment.author.login },
            body: comment.body,
            created_at: comment.createdAt,
            path: comment.path,
            line: comment.line,
            diff_hunk: comment.diffHunk,
          }))
        ),
      ];

      // Get general PR comments from REST API (filtered by timestamp)
      const prCommentData: CommentData[] = (
        await this.getPRComments(prNumber, repositoryPath, lastCommitTimestamp)
      ).map((comment) => ({
        id: comment.id,
        user: comment.user,
        body: comment.body,
        created_at: comment.created_at,
      }));

      const comments = processAllComments(
        [...prCommentData, ...reviewCommentData],
        {
          commentPrefix,
          currentUser,
          skipUsernameCheck,
        }
      );

      // Extract thread IDs directly from review threads
      const threadIds = reviewThreads.map((thread) => thread.id);

      return { comments, threadIds };
    } catch (error) {
      logger.error(
        'Failed to fetch PR comments via GitHub CLI:',
        String(error)
      );
      return { comments: [], threadIds: [] };
    }
  }

  async getPRComments(
    prNumber: number,
    repositoryPath: string,
    lastCommitTimestamp?: string | null
  ): Promise<GitHubComment[]> {
    await this.ensureInitialized(repositoryPath);

    return await withRetry(
      async () => {
        const result = await execCommand(
          'gh',
          [
            'api',
            `/repos/${this.repoOwner}/${this.repoName}/issues/${prNumber}/comments`,
          ],
          { cwd: repositoryPath }
        );
        if (result.exitCode !== 0) {
          throw new Error(`GitHub CLI command failed: ${result.stderr}`);
        }

        const allComments = JSON.parse(result.stdout) as GitHubComment[];

        // Filter by timestamp if provided
        if (!lastCommitTimestamp) {
          return allComments;
        }

        const lastCommitDate = new Date(lastCommitTimestamp);
        return allComments.filter((comment) => {
          const commentDate = new Date(comment.created_at);
          return commentDate > lastCommitDate;
        });
      },
      'Get PR comments via GitHub CLI',
      2
    );
  }

  private async fetchAllReviewThreads(
    prNumber: number,
    repositoryPath: string
  ): Promise<{
    reviewThreads: ReviewThread[];
    reviewBodies: GitHubReviewBody[];
  }> {
    await this.ensureInitialized(repositoryPath);

    try {
      const query = `
        query($owner: String!, $repo: String!, $prNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $prNumber) {
              reviews(first: 100) {
                nodes {
                  id
                  databaseId
                  body
                  state
                  author { login }
                  createdAt
                }
              }
              reviewThreads(first: 100) {
                nodes {
                  id
                  isResolved
                  comments(first: 100) {
                    nodes {
                      id
                      databaseId
                      body
                      author { login }
                      createdAt
                      path
                      line
                      diffHunk
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const result = await execCommand(
        'gh',
        [
          'api',
          'graphql',
          '-f',
          `query=${query}`,
          '-F',
          `owner=${this.repoOwner}`,
          '-F',
          `repo=${this.repoName}`,
          '-F',
          `prNumber=${prNumber}`,
        ],
        { cwd: repositoryPath }
      );

      if (result.exitCode !== 0) {
        throw new Error(`GitHub CLI command failed: ${result.stderr}`);
      }

      const response = JSON.parse(result.stdout);
      const reviewThreads =
        response.data?.repository?.pullRequest?.reviewThreads?.nodes || [];
      const reviewBodies =
        response.data?.repository?.pullRequest?.reviews?.nodes || [];

      return { reviewThreads, reviewBodies };
    } catch (error) {
      logger.warn(`Failed to fetch review threads: ${error}`);
      return { reviewThreads: [], reviewBodies: [] };
    }
  }

  async getUnresolvedReviewThreads(
    prNumber: number,
    repositoryPath: string
  ): Promise<{
    reviewThreads: ReviewThread[];
    reviewBodies: GitHubReviewBody[];
  }> {
    const { reviewThreads, reviewBodies } = await this.fetchAllReviewThreads(
      prNumber,
      repositoryPath
    );

    // Filter submitted reviews only (exclude PENDING)
    const submittedReviews = reviewBodies.filter(
      (review: GitHubReviewBody) => review.state !== 'PENDING'
    );

    // Filter unresolved threads only
    const unresolvedThreads = reviewThreads.filter(
      (thread: ReviewThread) => !thread.isResolved
    );

    return { reviewThreads: unresolvedThreads, reviewBodies: submittedReviews };
  }

  async resolveReviewThread(
    threadId: string,
    repositoryPath: string,
    taskId?: number
  ): Promise<boolean> {
    await this.ensureInitialized(repositoryPath);

    try {
      const mutation = `
        mutation($threadId: ID!) {
          resolveReviewThread(input: { threadId: $threadId }) {
            thread {
              id
              isResolved
            }
          }
        }
      `;

      const result = await execCommand(
        'gh',
        [
          'api',
          'graphql',
          '-f',
          `query=${mutation}`,
          '-f',
          `threadId=${threadId}`,
        ],
        { cwd: repositoryPath }
      );

      if (result.exitCode !== 0) {
        throw new Error(`GitHub CLI command failed: ${result.stderr}`);
      }

      if (taskId) {
        this.db.addTaskLog({
          task_id: taskId,
          level: 'info',
          message: `✅ Resolved review thread ${threadId}`,
        });
      }

      return true;
    } catch (error) {
      logger.warn(`Failed to resolve review thread ${threadId}: ${error}`);
      if (taskId) {
        this.db.addTaskLog({
          task_id: taskId,
          level: 'warn',
          message: `⚠️ Failed to resolve review thread ${threadId}: ${error}`,
        });
      }
      return false;
    }
  }

  async resolveThreadsByIds(
    threadIds: string[],
    repositoryPath: string,
    taskId?: number
  ): Promise<void> {
    if (threadIds.length === 0) {
      return;
    }

    if (taskId) {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `🔄 Resolving ${threadIds.length} review thread(s)...`,
      });
    }

    // Resolve all threads in parallel
    const results = await Promise.all(
      threadIds.map((threadId) =>
        this.resolveReviewThread(threadId, repositoryPath, taskId)
      )
    );

    const resolved = results.filter((success) => success).length;

    if (taskId) {
      this.db.addTaskLog({
        task_id: taskId,
        level: 'info',
        message: `✅ Successfully resolved ${resolved} review thread(s)`,
      });
    }
  }

  async getCurrentUser(repositoryPath: string): Promise<string | null> {
    await this.ensureInitialized(repositoryPath);

    return await withRetry(
      async () => {
        try {
          const result = await execCommand(
            'gh',
            ['api', 'user', '--jq', '.login'],
            { cwd: repositoryPath }
          );
          if (result.exitCode !== 0) {
            throw new Error(`GitHub CLI command failed: ${result.stderr}`);
          }
          return result.stdout.trim();
        } catch (error) {
          logger.warn(
            'Could not get current user from GitHub CLI:',
            String(error)
          );
          return null;
        }
      },
      'Get current user from GitHub CLI',
      2
    );
  }

  async getPRStatus(
    prNumber: number,
    repositoryPath: string
  ): Promise<{
    state: string;
    mergeable: boolean | null;
    merged: boolean;
  }> {
    await this.ensureInitialized(repositoryPath);

    return await withRetry(
      async () => {
        const result = await execCommand(
          'gh',
          [
            'pr',
            'view',
            prNumber.toString(),
            '--json',
            'state,mergeable,mergedAt',
          ],
          { cwd: repositoryPath }
        );
        if (result.exitCode !== 0) {
          throw new Error(`GitHub CLI command failed: ${result.stderr}`);
        }

        const data = JSON.parse(result.stdout);
        return {
          state: data.state || 'UNKNOWN',
          mergeable:
            data.mergeable === 'MERGEABLE'
              ? true
              : data.mergeable === 'CONFLICTING'
                ? false
                : null,
          merged: data.mergedAt !== null && data.mergedAt !== undefined,
        };
      },
      'Get PR status via GitHub CLI',
      2
    );
  }

  async getRecentUserPRs(
    repositoryPath: string
  ): Promise<Array<{ title: string; body: string; diff?: string }>> {
    await this.ensureInitialized(repositoryPath);

    try {
      const prTitlePrefix = this.settings.get('prTitlePrefix');

      // Use GraphQL to get recent PRs and filter out tool-generated ones
      const graphqlQuery = `query { viewer { pullRequests(first: 5, states: [OPEN, CLOSED, MERGED], orderBy: {field: CREATED_AT, direction: DESC}) { nodes { number title body author { login } } } } }`;

      const result = await execCommand(
        'gh',
        ['api', 'graphql', '-f', `query=${graphqlQuery}`],
        { cwd: repositoryPath }
      );

      if (result.exitCode !== 0) {
        logger.warn(`Could not fetch recent PRs: ${result.stderr}`);
        return [];
      }

      const graphqlResponse = JSON.parse(result.stdout);

      // Filter out PRs created by this tool (those with the prefix)
      const allPRs = graphqlResponse.data.viewer.pullRequests.nodes;
      const recentPRs = allPRs.filter(
        (pr: any) => !pr.title.startsWith(prTitlePrefix)
      );

      // For each PR, try to get the diff as well
      const prsWithDiff = await Promise.all(
        recentPRs.map(async (pr: any) => {
          try {
            const diffResult = await execCommand(
              'gh',
              ['pr', 'diff', pr.number.toString()],
              { cwd: repositoryPath }
            );

            // No need to strip prefix since we filtered out tool-generated PRs
            return {
              title: pr.title,
              body: pr.body || '',
              diff: diffResult.exitCode === 0 ? diffResult.stdout : undefined,
            };
          } catch (error) {
            return {
              title: pr.title,
              body: pr.body || '',
            };
          }
        })
      );

      logger.info(
        `Found ${prsWithDiff.length} recent user PRs as examples (excluding tool-generated PRs)`
      );
      return prsWithDiff;
    } catch (error) {
      logger.warn(`Failed to fetch recent PRs: ${error}`);
      return [];
    }
  }

  async getBranchDiff(
    branchName: string,
    repositoryPath: string
  ): Promise<string> {
    await this.ensureInitialized(repositoryPath);

    try {
      const defaultBranch = await this.getDefaultBranch(repositoryPath);

      const result = await execCommand(
        'git',
        ['diff', `${defaultBranch}...${branchName}`],
        { cwd: repositoryPath }
      );

      if (result.exitCode !== 0) {
        logger.warn(`Could not get branch diff: ${result.stderr}`);
        return '';
      }

      return result.stdout;
    } catch (error) {
      logger.warn(`Failed to get branch diff: ${error}`);
      return '';
    }
  }

  private logPREvent(taskId: number, message: string): void {
    this.db.addTaskLog({
      task_id: taskId,
      level: 'info',
      message,
    });
  }
}
