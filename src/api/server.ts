import express from 'express';
import cors from 'cors';
import path from 'path';
import { DatabaseManager } from '../core/database';
import { CoreEngine } from '../core/engine';
import { createRoutes } from './routes';

export class APIServer {
  private app: express.Application;
  private db: DatabaseManager;
  private engine: CoreEngine;
  private server: any;

  constructor(db: DatabaseManager, engine: CoreEngine) {
    this.db = db;
    this.engine = engine;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // Enable CORS
    this.app.use(cors());

    // Parse JSON bodies
    this.app.use(express.json({ limit: '10mb' }));

    // Parse URL-encoded bodies
    this.app.use(express.urlencoded({ extended: true }));

    // Serve static files from public directory
    this.app.use(express.static(path.join(__dirname, '../../public')));

    // Request logging middleware
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // API routes
    this.app.use('/api', createRoutes(this.db, this.engine));

    // HTML page routes
    this.app.get('/', (req, res) => {
      // Check if basic configuration is present
      const githubToken = this.db.getSetting('github_token');
      if (!githubToken) {
        return res.redirect('/settings');
      }
      res.sendFile(path.join(__dirname, '../../public/index.html'));
    });

    this.app.get('/tasks/:id', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/task-detail.html'));
    });

    this.app.get('/settings', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/settings.html'));
    });

    // Fallback for any other routes
    this.app.get('*', (req, res) => {
      res.redirect('/');
    });

    // Error handling middleware - must be last!
    this.app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error('Server error:', err);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    });
  }

  async start(port: number = 3000): Promise<void> {
    // Initialize the engine
    await this.engine.initialize();

    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        console.log(`🚀 Duckling server running on http://localhost:${port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        console.log('🔄 Stopping API server...');

        // Set a timeout for server close
        const timeout = setTimeout(() => {
          console.log('⚠️  Server close timeout, forcing shutdown');
          this.server.destroy();
          resolve();
        }, 5000);

        this.server.close((err: any) => {
          clearTimeout(timeout);
          if (err) {
            console.error('Error stopping server:', err);
            reject(err);
          } else {
            console.log('✅ API server stopped');
            resolve();
          }
        });

        // Close all active connections
        this.server.closeAllConnections();
      } else {
        resolve();
      }
    });
  }

  getApp(): express.Application {
    return this.app;
  }
}
