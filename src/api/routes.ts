import { Router, Request, Response } from 'express';
import { DatabaseManager } from '../core/database';
import { SettingsManager } from '../core/settings-manager';
import { CoreEngine } from '../core/engine';
import { ApiResponse, CreateTaskRequest } from '../types';

export function createRoutes(db: DatabaseManager, engine: CoreEngine): Router {
  const router = Router();
  const settings = new SettingsManager(db);

  // Health check
  router.get('/health', (req: Request, res: Response) => {
    res.json({ success: true, data: { status: 'healthy', timestamp: new Date().toISOString() } });
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
        offset
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
            totalPages: Math.ceil(totalCount / limitNum)
          }
        }
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  router.post('/tasks', async (req: Request, res: Response) => {
    try {
      const { description } = req.body;

      // Validate required fields
      if (!description) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: description'
        });
      }

      // Get default coding tool from settings
      const defaultCodingTool = db.getSetting('defaultCodingTool');
      const codingTool = (defaultCodingTool?.value as 'amp' | 'openai') || 'amp'; // Default to amp if not set

      const taskRequest: CreateTaskRequest = {
        title: description.substring(0, 50) + (description.length > 50 ? '...' : ''),
        description,
        codingTool
      };

      const taskId = await engine.createTask(taskRequest);

      const response: ApiResponse = {
        success: true,
        data: { taskId }
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  router.get('/tasks/:id', async (req: Request, res: Response) => {
    try {
      const task = db.getTask(parseInt(req.params.id));

      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found'
        });
      }

      const response: ApiResponse = {
        success: true,
        data: task
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  router.put('/tasks/:id', async (req: Request, res: Response) => {
    try {
      const task = db.getTask(parseInt(req.params.id));

      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found'
        });
      }

      db.updateTask(parseInt(req.params.id), req.body);

      const response: ApiResponse = {
        success: true,
        data: { message: 'Task updated successfully' }
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  router.post('/tasks/:id/cancel', async (req: Request, res: Response) => {
    try {
      const task = db.getTask(parseInt(req.params.id));

      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found'
        });
      }

      await engine.cancelTask(parseInt(req.params.id));

      const response: ApiResponse = {
        success: true,
        data: { message: 'Task cancelled successfully' }
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  router.get('/tasks/:id/commits', async (req: Request, res: Response) => {
    try {
      // For now, return empty array as commits aren't tracked yet
      const response: ApiResponse = {
        success: true,
        data: []
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
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
        after: after ? parseInt(after as string) : undefined
      });

      const response: ApiResponse = {
        success: true,
        data: logs
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  router.post('/tasks/:id/retry', async (req: Request, res: Response) => {
    try {
      await engine.retryTask(parseInt(req.params.id));

      const response: ApiResponse = {
        success: true,
        data: { message: 'Task retry initiated' }
      };

      res.json(response);
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  });

  // Repo info endpoint
  router.get('/repo-info', async (req: Request, res: Response) => {
    try {
      const { validateAndGetRepoInfo } = await import('../utils/git-utils');
      const repoInfo = await validateAndGetRepoInfo(process.cwd());

      const response: ApiResponse = {
        success: true,
        data: {
          owner: repoInfo.owner,
          name: repoInfo.name
        }
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
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
        data: sanitizedSettings
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  router.put('/settings', async (req: Request, res: Response) => {
    try {
      const settings = req.body;
      // Update each setting
      for (const [key, value] of Object.entries(settings)) {
        // Skip empty API keys/tokens (means don't change the existing value)
        if ((key.toLowerCase().includes('token') || key.toLowerCase().includes('apikey')) &&
          (!value || value === '' || value === '***CONFIGURED***')) {
          continue;
        }

        db.setSetting(key, value as string);
      }

      const response: ApiResponse = {
        success: true,
        data: { message: 'Settings updated successfully' }
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Precommit checks endpoints
  router.get('/precommit-checks', async (req: Request, res: Response) => {
    try {
      const checks = db.getAllPrecommitChecks();

      const response: ApiResponse = {
        success: true,
        data: checks
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  router.post('/precommit-checks', async (req: Request, res: Response) => {
    try {
      const { name, command } = req.body;

      if (!name || !command) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: name and command'
        });
      }

      const id = db.addPrecommitCheck({
        name,
        command,
        order_index: 0
      });

      const response: ApiResponse = {
        success: true,
        data: { id }
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
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
        data: { message: 'Precommit check updated successfully' }
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  router.delete('/precommit-checks/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);

      db.deletePrecommitCheck(id);

      const response: ApiResponse = {
        success: true,
        data: { message: 'Precommit check deleted successfully' }
      };

      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Server-Sent Events endpoint for real-time updates
  router.get('/events', (req: Request, res: Response) => {
    // Set headers for SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

    // Listen for task updates from engine
    const handleTaskUpdate = (event: any) => {
      res.write(`data: ${JSON.stringify({ type: 'task-update', ...event })}\n\n`);
    };

    engine.on('task-update', handleTaskUpdate);

    // Send periodic heartbeat
    const heartbeat = setInterval(() => {
      res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
    }, 30000); // Every 30 seconds

    // Clean up on connection close
    req.on('close', () => {
      engine.removeListener('task-update', handleTaskUpdate);
      clearInterval(heartbeat);
    });
  });

  return router;
}
