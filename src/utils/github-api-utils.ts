/**
 * GitHub API Utilities - Validation and configuration for GitHub API with Apps
 */

import { logger } from './logger';

export interface GitHubAppConfig {
  appId: string;
  installationId: string;
  privateKey: string; // PEM format private key
}

/**
 * Check if GitHub App configuration is valid
 */
export function validateGitHubAppConfig(config: GitHubAppConfig): boolean {
  if (!config.appId || !config.installationId || !config.privateKey) {
    logger.warn(
      'GitHub App configuration incomplete: missing appId, installationId, or privateKey'
    );
    return false;
  }

  // Basic validation of private key format
  if (
    !config.privateKey.includes('-----BEGIN') ||
    !config.privateKey.includes('-----END')
  ) {
    logger.warn(
      'GitHub App private key appears to be in wrong format (should be PEM)'
    );
    return false;
  }

  return true;
}

/**
 * Generate JWT token for GitHub App authentication
 */
export async function generateGitHubAppJWT(
  appId: string,
  privateKey: string
): Promise<string> {
  const crypto = await import('crypto');

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 10, // Issued 10 seconds in the past to allow for clock drift
    exp: now + 60 * 10, // JWT expires in 10 minutes
    iss: appId,
  };

  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    'base64url'
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url'
  );

  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createSign('RSA-SHA256')
    .update(signingInput)
    .sign(privateKey, 'base64url');

  return `${signingInput}.${signature}`;
}

/**
 * Test GitHub App authentication by making a simple API call
 */
export async function testGitHubAppAuthentication(
  config: GitHubAppConfig
): Promise<boolean> {
  try {
    if (!validateGitHubAppConfig(config)) {
      return false;
    }

    const jwt = await generateGitHubAppJWT(config.appId, config.privateKey);

    // Test installation access token generation
    const response = await fetch(
      `https://api.github.com/app/installations/${config.installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Duckling-GitHub-App/1.0',
        },
      }
    );

    if (response.status === 201) {
      logger.info('GitHub App authentication test successful');
      return true;
    } else {
      logger.warn(`GitHub App authentication test failed: ${response.status}`);
      return false;
    }
  } catch (error) {
    logger.warn('GitHub App authentication test failed:', String(error));
    return false;
  }
}
