import { APIServer } from './api/server';
import { isGitHubCLIAvailable } from './utils/github-cli-utils';
import { DatabaseManager } from './core/database';
import { SettingsManager } from './core/settings-manager';
import { CodingManager } from './core/coding-manager';
import { PrecommitManager } from './core/precommit-manager';
import { OpenAIManager } from './core/openai-manager';
import { CoreEngine } from './core/engine';

export async function startDuckling(port: number = 5050): Promise<void> {
  console.log('🚀 Starting Duckling...');

  // Create dependencies
  const db = new DatabaseManager();
  const settings = new SettingsManager(db);
  const codingManager = new CodingManager(settings);
  const precommitManager = new PrecommitManager(db);
  const openaiManager = new OpenAIManager(db, settings);

  // Create engine with dependencies
  const engine = new CoreEngine(
    db,
    settings,
    codingManager,
    precommitManager,
    openaiManager
  );

  const server = new APIServer(db, engine);

  // Check GitHub CLI availability - fail if not available
  try {
    const cliAvailable = await isGitHubCLIAvailable();
    if (!cliAvailable) {
      console.error('❌ GitHub CLI is not installed or authenticated');
      console.error('   Please install and authenticate GitHub CLI:');
      console.error('   1. Install: https://github.com/cli/cli#installation');
      console.error('   2. Authenticate: gh auth login');
      process.exit(1);
    }
    console.log('🔑 GitHub CLI: Ready');
  } catch (error) {
    console.error('❌ Failed to check GitHub CLI status:', error);
    process.exit(1);
  }

  await server.start(port);

  console.log(`✅ Duckling is running at http://localhost:${port}`);

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 Shutting down Duckling...');
    engine.shutdown();
    await server.stop();
    db.close();
    console.log('✅ Duckling shut down gracefully');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Export main components for programmatic use
export { DatabaseManager } from './core/database';
export { CoreEngine } from './core/engine';
export { APIServer } from './api/server';

export * from './types';

// If this file is run directly, start the server
if (require.main === module) {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 5050;
  startDuckling(port).catch((error) => {
    console.error('❌ Failed to start Duckling:', error);
    process.exit(1);
  });
}
