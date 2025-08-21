# GitHub API Provider

This provider implements GitHub operations using the GitHub REST API directly instead of the GitHub CLI. It supports GitHub Apps authentication and is designed to be interchangeable with the `GitHubCLIProvider`.

## Key Features

- **Direct API Calls**: Uses native `fetch` calls to GitHub REST API endpoints
- **GitHub Apps Authentication**: Supports GitHub App authentication via JWT tokens
- **Interchangeable Interface**: Same methods and signatures as `GitHubCLIProvider`
- **Full Feature Parity**: Supports all operations including PR creation, comment polling, reviews, etc.

## Authentication

The provider supports GitHub Apps authentication through:

1. **App ID**: Your GitHub App's ID
2. **Private Key**: RSA private key for JWT signing  
3. **Installation ID**: The installation ID for the specific repository/organization

```typescript
const githubProvider = new GitHubAPIProvider(
  db,
  openaiManager,
  settings,
  jiraManager,
  {
    appId: "123456",
    privateKey: "-----BEGIN RSA PRIVATE KEY-----...",
    installationId: "789012"
  }
);
```

## Core Methods

All methods match the `GitHubCLIProvider` interface:

- `getDefaultBranch(repositoryPath)` - Get repository's default branch
- `createPR(branchName, title, description, taskId, repositoryPath)` - Create pull request
- `createPRFromTask(branchName, task, repositoryPath)` - Create PR with OpenAI-generated content
- `findPRByBranch(branchName, repositoryPath)` - Find existing PR by branch name
- `pollForComments(prNumber, lastCommitTimestamp, repositoryPath)` - Poll for new comments
- `getPRStatus(prNumber, repositoryPath)` - Get PR state and mergeability
- `getCurrentUser(repositoryPath)` - Get authenticated user info
- `getRecentUserPRs(repositoryPath)` - Get recent user PRs for examples

## Implementation Details

### JWT Token Generation
- Uses Node.js built-in `crypto` module for RSA-SHA256 signing
- Implements proper Base64URL encoding
- Handles token expiration and refresh automatically

### API Request Handling
- Automatic token management and refresh
- Proper error handling with meaningful messages
- Consistent response typing with TypeScript interfaces

### Repository State Management
- Caches repository information per path
- Re-initializes when repository path changes
- Validates git repository structure

## Advantages over CLI Provider

1. **No CLI Dependencies**: Works without requiring `gh` CLI installation
2. **Better Performance**: Direct API calls without shell process overhead  
3. **Enhanced Control**: Full access to API response headers and metadata
4. **GitHub Apps Support**: Native support for GitHub Apps authentication model
5. **Rate Limit Awareness**: Can inspect rate limit headers and implement backoff

## Usage in Duckling

The provider is designed to be a drop-in replacement for `GitHubCLIProvider`. To integrate:

1. Update dependency injection to use `GitHubAPIProvider`
2. Provide GitHub App configuration
3. No other code changes required due to interface compatibility

```typescript
// In CoreEngine or similar
private getGitHubManager(): GitHubAPIProvider {
  if (this.githubManager) {
    return this.githubManager;
  }

  const appConfig = {
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_PRIVATE_KEY,
    installationId: process.env.GITHUB_INSTALLATION_ID
  };

  this.githubManager = new GitHubAPIProvider(
    this.db,
    this.openaiManager, 
    this.settings,
    this.jiraManager,
    appConfig
  );
  
  return this.githubManager;
}
```
