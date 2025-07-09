/**
 * GitHub Interface - Defines the contract for GitHub operations
 *
 * This interface allows for different implementations of GitHub operations,
 * such as using GitHub tokens or GitHub CLI.
 */

export interface GitHubProvider {
  /**
   * Get the default branch for a repository
   */
  getDefaultBranch(repositoryPath: string): Promise<string>;

  /**
   * Create a pull request from a task
   */
  createPRFromTask(
    branchName: string,
    taskDescription: string,
    taskId: number,
    repositoryPath: string
  ): Promise<{ number: number; url: string }>;

  /**
   * Create a pull request
   */
  createPR(
    branchName: string,
    title: string,
    description: string,
    taskId: number,
    repositoryPath: string
  ): Promise<{ number: number; url: string }>;

  /**
   * Find a pull request by branch name
   */
  findPRByBranch(branchName: string, repositoryPath?: string): Promise<any>;

  /**
   * Poll for new comments on a pull request
   */
  pollForComments(
    prNumber: number,
    lastCommitTimestamp: string | null,
    repositoryPath: string
  ): Promise<string[]>;

  /**
   * Get PR reviews
   */
  getPRReviews(prNumber: number, repositoryPath: string): Promise<any[]>;

  /**
   * Get comments for a specific review
   */
  getCommentsForReview(
    prNumber: number,
    reviewId: number,
    repositoryPath: string
  ): Promise<any[]>;

  /**
   * Get PR review comments
   */
  getPRReviewComments(prNumber: number, repositoryPath: string): Promise<any[]>;

  /**
   * Get PR status
   */
  getPRStatus(
    prNumber: number,
    repositoryPath: string
  ): Promise<{
    state: string;
    mergeable: boolean | null;
    merged: boolean;
  }>;
}

/**
 * GitHub provider factory - creates appropriate provider based on configuration
 */
export interface GitHubProviderFactory {
  createProvider(): Promise<GitHubProvider>;
}
