import { simpleGit } from 'simple-git';
import { logger } from './logger';

export interface GitRepoInfo {
  repoPath: string;
  remoteUrl: string;
  owner: string;
  name: string;
}

export async function validateAndGetRepoInfo(
  workingDir: string
): Promise<GitRepoInfo> {
  const git = simpleGit(workingDir);

  try {
    // Check if this is a git repository
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      throw new Error(
        `Directory ${workingDir} is not a git repository. Please run duckling from within a git repository.`
      );
    }

    // Get remote URL
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((remote) => remote.name === 'origin');
    if (!origin || !origin.refs.fetch) {
      throw new Error(
        'No origin remote found. Please ensure the repository has a GitHub origin remote.'
      );
    }

    const remoteUrl = origin.refs.fetch;

    // Parse GitHub URL
    const githubMatch = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (!githubMatch) {
      throw new Error(
        'Origin remote is not a GitHub repository. Please ensure you are working with a GitHub repository.'
      );
    }

    const owner = githubMatch[1];
    const name = githubMatch[2];

    const repoInfo: GitRepoInfo = {
      repoPath: workingDir,
      remoteUrl: remoteUrl.replace(/\.git$/, ''),
      owner,
      name,
    };

    logger.info(
      `Git repository validated: ${owner}/${name}`
    );

    return repoInfo;
  } catch (error: any) {
    logger.error(`Git repository validation failed: ${error.message}`);
    throw error;
  }
}

export function getGitHubUrl(repoInfo: GitRepoInfo): string {
  return `https://github.com/${repoInfo.owner}/${repoInfo.name}`;
}
