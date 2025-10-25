/**
 * GitHub CLI Utilities - Detection and validation for GitHub CLI
 */

import { logger } from './logger';
import { execCommand } from './exec';
import { toMessage } from './error-utils';

/**
 * Check if GitHub CLI is available (both installed and authenticated)
 */
export async function isGitHubCLIAvailable(): Promise<boolean> {
  // Check if GitHub CLI is installed
  try {
    await execCommand('gh', ['--version']);
  } catch (error: unknown) {
    logger.debug('GitHub CLI not installed:', toMessage(error));
    return false;
  }

  // Check authentication status by exit code (works for both github.com and enterprise)
  try {
    const result = await execCommand('gh', ['auth', 'status']);
    return result.exitCode === 0;
  } catch (error: unknown) {
    // If gh auth status returns non-zero exit code, user is not authenticated
    logger.debug('GitHub CLI not authenticated:', toMessage(error));
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
    const result = await execCommand('gh', command.split(' '));
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error: unknown) {
    logger.error('GitHub CLI command failed:', toMessage(error));
    throw error;
  }
}
