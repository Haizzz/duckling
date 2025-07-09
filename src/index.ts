import { DatabaseManager } from './core/database';
import { CoreEngine } from './core/engine';
import { APIServer } from './api/server';
import { getGitHubAuthStatus } from './core/github-provider-factory';

export async function startDuckling(port: number = 5050): Promise<void> {
  console.log('🚀 Starting Duckling...');

  const db = new DatabaseManager();
  const engine = new CoreEngine(db);
  const server = new APIServer(db, engine);

  // Check GitHub authentication status and display it
  try {
    const authStatus = await getGitHubAuthStatus();
    if (authStatus.method === 'cli' && authStatus.authenticated) {
      console.log(
        `🔑 GitHub authentication: GitHub CLI (${authStatus.username || 'authenticated'})`
      );
    } else if (authStatus.method === 'token' && authStatus.authenticated) {
      console.log('🔑 GitHub authentication: Personal Access Token');
    } else {
      console.log('⚠️  GitHub authentication: Not configured');
    }
  } catch (error) {
    console.log('⚠️  GitHub authentication: Status check failed');
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
export { DatabaseManager, CoreEngine, APIServer };

export * from './types';

// If this file is run directly, start the server
if (require.main === module) {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 5050;
  startDuckling(port).catch((error) => {
    console.error('❌ Failed to start Duckling:', error);
    process.exit(1);
  });
}
