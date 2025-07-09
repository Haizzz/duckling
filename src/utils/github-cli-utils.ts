/**
 * GitHub CLI Utilities - Detection and validation for GitHub CLI
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';

const execAsync = promisify(exec);

/**
 * Get comprehensive GitHub CLI status in a single call
 */
export async function getGitHubCLIStatus(): Promise<{
  installed: boolean;
  authenticated: boolean;
  username?: string;
}> {
  // Check if GitHub CLI is installed
  try {
    await execAsync('gh --version');
  } catch (error) {
    logger.debug('GitHub CLI not installed:', String(error));
    return { installed: false, authenticated: false };
  }

  // Check authentication status by exit code (works for both github.com and enterprise)
  try {
    const result = await execAsync('gh auth status');
    const output = result.stderr || result.stdout;

    let username: string | undefined;
    // Extract username from output like "Logged in to github.com as username" or "Logged in to enterprise.com as username"
    const usernameMatch = output.match(/as\s+(\w+)/);
    if (usernameMatch) {
      username = usernameMatch[1];
    }

    return { installed: true, authenticated: true, username };
  } catch (error) {
    // If gh auth status returns non-zero exit code, user is not authenticated
    logger.debug('GitHub CLI not authenticated:', String(error));
    return { installed: true, authenticated: false };
  }
}

/**
 * Check if GitHub CLI is available and authenticated (convenience function)
 */
export async function isGitHubCLIAvailable(): Promise<boolean> {
  const status = await getGitHubCLIStatus();
  return status.installed && status.authenticated;
}

/**
 * Check if GitHub CLI is installed (convenience function)
 */
export async function isGitHubCLIInstalled(): Promise<boolean> {
  const status = await getGitHubCLIStatus();
  return status.installed;
}

/**
 * Check if GitHub CLI is authenticated (convenience function)
 */
export async function isGitHubCLIAuthenticated(): Promise<boolean> {
  const status = await getGitHubCLIStatus();
  return status.authenticated;
}

/**
 * Execute a GitHub CLI command
 */
export async function executeGitHubCLI(
  command: string
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execAsync(`gh ${command}`);
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error: any) {
    logger.error('GitHub CLI command failed:', error.message);
    throw error;
  }
}
