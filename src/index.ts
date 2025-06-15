import { DatabaseManager } from './core/database';
import { CoreEngine } from './core/engine';
import { APIServer } from './api/server';
import { validateAndGetRepoInfo, getGitHubUrl } from './utils/git-utils';

export async function startDuckling(port: number = 5050): Promise<void> {
  console.log('🚀 Starting Duckling...');
  
  const db = new DatabaseManager();
  
  // Validate git repository (but don't store URL as it's not needed)
  try {
    const repoInfo = await validateAndGetRepoInfo(process.cwd());
    const githubUrl = getGitHubUrl(repoInfo);
    console.log(`📁 Repository: ${githubUrl}`);
  } catch (error: any) {
    console.warn(`⚠️  Could not determine repository URL: ${error.message}`);
  }
  
  const engine = new CoreEngine(db);
  const server = new APIServer(db, engine);
  
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
export {
  DatabaseManager,
  CoreEngine,
  APIServer
};

export * from './types';

// If this file is run directly, start the server
if (require.main === module) {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 5050;
  startDuckling(port).catch(error => {
    console.error('❌ Failed to start Duckling:', error);
    process.exit(1);
  });
}
