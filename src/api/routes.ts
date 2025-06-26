import { Router, Request, Response } from 'express';
import fs from 'fs';
import pathLib from 'path';
import { execSync } from 'child_process';
import { DatabaseManager } from '../core/database';
import { SettingsManager } from '../core/settings-manager';
import { CoreEngine } from '../core/engine';
import { ApiResponse, CreateTaskRequest } from '../types';

export function createRoutes(db: DatabaseManager, engine: CoreEngine): Router {
  const router = Router();
  const settings = new SettingsManager(db);

  // Health check
  router.get('/health', (req: Request, res: Response) => {
    res.json({
      success: true,
      data: { status: 'healthy', timestamp: new Date().toISOString() },
    });
  });

  // Tasks endpoints
  router.get('/tasks', async (req: Request, res: Response) => {
    try {
      const { status, page = '1', limit = '10' } = req.query;
      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const offset = (pageNum - 1) * limitNum;

      const tasks = db.getTasks({
        status: status as string,
        limit: limitNum,
        offset,
      });

      // Get total count for pagination
      const allTasks = db.getTasks({ status: status as string });
      const totalCount = allTasks.length;

      const response: ApiResponse = {
        success: true,
        data: {
          tasks,
          pagination: {
            currentPage: pageNum,
            limit: limitNum,
            total: totalCount,
            totalPages: Math.ceil(totalCount / limitNum),
          },
        },
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post('/tasks', async (req: Request, res: Response) => {
    try {
      const { description, repositoryPath } = req.body;

      // Validate required fields
      if (!description) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: description',
        });
      }

      if (!repositoryPath) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: repositoryPath',
        });
      }

      // Validate repository exists
      const repository = db.getRepository(repositoryPath);
      if (!repository) {
        return res.status(400).json({
          success: false,
          error: 'Repository not found. Please add the repository first.',
        });
      }

      // Get default coding tool from settings
      const defaultCodingTool = db.getSetting('defaultCodingTool');
      const codingTool =
        (defaultCodingTool?.value as 'amp' | 'openai') || 'amp'; // Default to amp if not set

      const taskRequest: CreateTaskRequest = {
        title:
          description.substring(0, 50) + (description.length > 50 ? '...' : ''),
        description,
        codingTool,
        repositoryPath,
      };

      const taskId = await engine.createTask(taskRequest);

      const response: ApiResponse = {
        success: true,
        data: { taskId },
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get('/tasks/:id', async (req: Request, res: Response) => {
    try {
      const task = db.getTask(parseInt(req.params.id));

      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found',
        });
      }

      const response: ApiResponse = {
        success: true,
        data: task,
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.put('/tasks/:id', async (req: Request, res: Response) => {
    try {
      const task = db.getTask(parseInt(req.params.id));

      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found',
        });
      }

      db.updateTask(parseInt(req.params.id), req.body);

      const response: ApiResponse = {
        success: true,
        data: { message: 'Task updated successfully' },
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post('/tasks/:id/cancel', async (req: Request, res: Response) => {
    try {
      const task = db.getTask(parseInt(req.params.id));

      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found',
        });
      }

      await engine.cancelTask(parseInt(req.params.id));

      const response: ApiResponse = {
        success: true,
        data: { message: 'Task cancelled successfully' },
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post('/tasks/:id/complete', async (req: Request, res: Response) => {
    try {
      const task = db.getTask(parseInt(req.params.id));

      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found',
        });
      }

      // Update task status to completed
      db.updateTask(parseInt(req.params.id), {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });

      // Emit task update event for real-time updates
      const updatedTask = db.getTask(parseInt(req.params.id));
      engine.emit('task-update', {
        taskId: parseInt(req.params.id),
        status: 'completed',
        metadata: { task: updatedTask },
      });

      const response: ApiResponse = {
        success: true,
        data: { message: 'Task marked as completed successfully' },
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get('/tasks/:id/commits', async (req: Request, res: Response) => {
    try {
      // For now, return empty array as commits aren't tracked yet
      const response: ApiResponse = {
        success: true,
        data: [],
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get('/tasks/:id/logs', async (req: Request, res: Response) => {
    try {
      const { level, page = '1', limit = '100', after } = req.query;
      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const offset = (pageNum - 1) * limitNum;

      const logs = db.getTaskLogs(parseInt(req.params.id), {
        level: level as string,
        limit: limitNum,
        offset: after ? undefined : offset, // Don't use offset when using after
        after: after ? parseInt(after as string) : undefined,
      });

      const response: ApiResponse = {
        success: true,
        data: logs,
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post('/tasks/:id/retry', async (req: Request, res: Response) => {
    try {
      await engine.retryTask(parseInt(req.params.id));

      const response: ApiResponse = {
        success: true,
        data: { message: 'Task retry initiated' },
      };

      res.json(response);
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Settings endpoints
  router.get('/settings', async (req: Request, res: Response) => {
    try {
      const settingsObj = settings.getAll();

      // For password fields, return a special indicator if value exists
      const secureFields = ['githubToken', 'ampApiKey', 'openaiApiKey'];
      const sanitizedSettings: Record<string, any> = {};

      for (const [key, value] of Object.entries(settingsObj)) {
        if (secureFields.includes(key)) {
          sanitizedSettings[key] = value ? '***CONFIGURED***' : '';
        } else {
          sanitizedSettings[key] = value;
        }
      }

      const response: ApiResponse = {
        success: true,
        data: sanitizedSettings,
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.put('/settings', async (req: Request, res: Response) => {
    try {
      const settings = req.body;
      // Update each setting
      for (const [key, value] of Object.entries(settings)) {
        // Skip empty API keys/tokens (means don't change the existing value)
        if (
          (key.toLowerCase().includes('token') ||
            key.toLowerCase().includes('apikey')) &&
          (!value || value === '' || value === '***CONFIGURED***')
        ) {
          continue;
        }

        db.setSetting(key, value as string);
      }

      const response: ApiResponse = {
        success: true,
        data: { message: 'Settings updated successfully' },
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Precommit checks endpoints
  router.get('/precommit-checks', async (req: Request, res: Response) => {
    try {
      const checks = db.getAllPrecommitChecks();

      const response: ApiResponse = {
        success: true,
        data: checks,
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post('/precommit-checks', async (req: Request, res: Response) => {
    try {
      const { name, command } = req.body;

      if (!name || !command) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: name and command',
        });
      }

      const id = db.addPrecommitCheck({
        name,
        command,
        order_index: 0,
      });

      const response: ApiResponse = {
        success: true,
        data: { id },
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.put('/precommit-checks/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;

      db.updatePrecommitCheck(id, updates);

      const response: ApiResponse = {
        success: true,
        data: { message: 'Precommit check updated successfully' },
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.delete(
    '/precommit-checks/:id',
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id);

        db.deletePrecommitCheck(id);

        const response: ApiResponse = {
          success: true,
          data: { message: 'Precommit check deleted successfully' },
        };

        res.json(response);
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  );

  // Server-Sent Events endpoint for real-time updates
  router.get('/events', (req: Request, res: Response) => {
    // Set headers for SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    });

    // Send initial connection message
    res.write(
      `data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`
    );

    // Listen for task updates from engine
    const handleTaskUpdate = (event: any) => {
      res.write(
        `data: ${JSON.stringify({ type: 'task-update', ...event })}\n\n`
      );
    };

    engine.on('task-update', handleTaskUpdate);

    // Send periodic heartbeat
    const heartbeat = setInterval(() => {
      res.write(
        `data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`
      );
    }, 30000); // Every 30 seconds

    // Clean up on connection close
    req.on('close', () => {
      engine.removeListener('task-update', handleTaskUpdate);
      clearInterval(heartbeat);
    });
  });

  // Repository endpoints
  router.get('/repositories', async (req: Request, res: Response) => {
    try {
      const repositories = db.getRepositories();
      const response: ApiResponse = {
        success: true,
        data: repositories,
      };
      res.json(response);
    } catch (error) {
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      res.status(500).json(response);
    }
  });

  router.post('/repositories', async (req: Request, res: Response) => {
    try {
      const { path } = req.body;

      if (!path) {
        const response: ApiResponse = {
          success: false,
          error: 'Repository path is required',
        };
        return res.status(400).json(response);
      }

      // Validate repository exists and get details
      if (!fs.existsSync(path) || !fs.lstatSync(path).isDirectory()) {
        const response: ApiResponse = {
          success: false,
          error: 'Path does not exist or is not a directory',
        };
        return res.status(400).json(response);
      }

      const gitDir = pathLib.join(path, '.git');
      if (!fs.existsSync(gitDir)) {
        const response: ApiResponse = {
          success: false,
          error: 'Path is not a Git repository',
        };
        return res.status(400).json(response);
      }

      // Check if repository already exists
      const existingRepo = db.getRepository(path);
      if (existingRepo) {
        const response: ApiResponse = {
          success: false,
          error: 'Repository already exists',
        };
        return res.status(400).json(response);
      }

      // Get repository details from Git
      try {
        const remoteUrl = execSync('git remote get-url origin', {
          cwd: path,
          encoding: 'utf8',
        }).trim();

        // Extract owner/name from remote URL
        const urlMatch = remoteUrl.match(
          /github\.com[:/](.+?)\/(.+?)(?:\.git)?$/
        );
        if (!urlMatch) {
          const response: ApiResponse = {
            success: false,
            error: 'Could not parse GitHub repository URL',
          };
          return res.status(400).json(response);
        }

        const [, owner, name] = urlMatch;

        db.addRepository({
          path,
          name,
          owner,
        });

        const newRepo = db.getRepository(path);
        const response: ApiResponse = {
          success: true,
          data: newRepo,
        };
        res.json(response);
      } catch (gitError) {
        const response: ApiResponse = {
          success: false,
          error: 'Failed to get repository details from Git',
        };
        res.status(400).json(response);
      }
    } catch (error) {
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      res.status(500).json(response);
    }
  });

  router.delete('/repositories/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);

      if (isNaN(id)) {
        const response: ApiResponse = {
          success: false,
          error: 'Invalid repository ID',
        };
        return res.status(400).json(response);
      }

      db.deleteRepository(id);

      const response: ApiResponse = {
        success: true,
        data: { message: 'Repository removed successfully' },
      };
      res.json(response);
    } catch (error) {
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      res.status(500).json(response);
    }
  });

  return router;
}
