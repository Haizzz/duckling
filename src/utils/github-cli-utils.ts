/**
 * GitHub CLI Utilities - Detection and validation for GitHub CLI
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';

const execAsync = promisify(exec);

/**
 * Check if GitHub CLI is available (both installed and authenticated)
 */
export async function isGitHubCLIAvailable(): Promise<boolean> {
  // Check if GitHub CLI is installed
  try {
    await execAsync('gh --version');
  } catch (error) {
    logger.debug('GitHub CLI not installed:', String(error));
    return false;
  }

  // Check authentication status by exit code (works for both github.com and enterprise)
  try {
    await execAsync('gh auth status');
    return true;
  } catch (error) {
    // If gh auth status returns non-zero exit code, user is not authenticated
    logger.debug('GitHub CLI not authenticated:', String(error));
    return false;
  }
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
