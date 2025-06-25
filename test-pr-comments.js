#!/usr/bin/env node

const { DatabaseManager } = require('./dist/core/database.js');
const { GitHubManager } = require('./dist/core/github-manager.js');
const { SettingsManager } = require('./dist/core/settings-manager.js');

async function testPRComments() {
  try {
    console.log('🔍 Testing PR comments functionality...');

    // Initialize database and settings
    const db = new DatabaseManager(':memory:');
    const settings = new SettingsManager(db);

    // Get GitHub token from environment or settings
    const githubToken = process.env.GITHUB_TOKEN || settings.get('githubToken');
    if (!githubToken) {
      console.error('❌ GitHub token not found. Set GITHUB_TOKEN environment variable or add it to your settings.');
      console.error('For this test, you can run: GITHUB_TOKEN=your_token_here node test-pr-comments.js');
      process.exit(1);
    }

    // Create GitHub manager
    const githubManager = new GitHubManager(githubToken, db);

    // Manually set repo info to avoid needing local git repository
    githubManager.repoOwner = 'Canva';
    githubManager.repoName = 'canva';
    githubManager.initialized = true;

    // Test with the specific PR
    const prNumber = 695690;
    const targetUsername = 'Haizzz'; // Replace with actual username if different
    const repositoryPath = './'; // Not used since we set repo info manually
    const lastCommitTimestamp = null; // We disabled the check anyway

    console.log(`📝 Testing PR #${prNumber} in ${repositoryPath}`);
    console.log(`👤 Looking for reviews from: ${targetUsername}`);
    console.log('');

    const comments = await githubManager.pollForComments(
      prNumber,
      lastCommitTimestamp,
      targetUsername,
      repositoryPath
    );

    console.log(`✅ Found ${comments.length} review(s):`);
    console.log('');

    comments.forEach((comment, index) => {
      console.log(`--- Review ${index + 1} ---`);
      console.log(comment);
      console.log('');
    });

    if (comments.length === 0) {
      console.log('🤔 No reviews found. This could mean:');
      console.log('  - The username doesn\'t match');
      console.log('  - The review is in PENDING state');
      console.log('  - There are no reviews from this user');
      console.log('  - The repository path is incorrect');
    }

  } catch (error) {
    console.error('❌ Error testing PR comments:', error.message);
    console.error(error.stack);
  }
}

testPRComments();
