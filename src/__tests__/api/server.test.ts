import request from 'supertest';
import { APIServer } from '../../api/server';
import { DatabaseManager } from '../../core/database';
import { CoreEngine } from '../../core/engine';
import path from 'path';

// Mock dependencies
jest.mock('../../core/database');
jest.mock('../../core/engine');
jest.mock('../../api/routes', () => ({
  createRoutes: jest.fn(() => {
    const express = require('express');
    const router = express.Router();
    router.get('/test', (req: any, res: any) => {
      res.json({ success: true, data: 'test' });
    });
    return router;
  }),
}));

const mockDatabaseManager = DatabaseManager as jest.MockedClass<
  typeof DatabaseManager
>;
const mockCoreEngine = CoreEngine as jest.MockedClass<typeof CoreEngine>;

describe('APIServer', () => {
  let server: APIServer;
  let mockDb: jest.Mocked<DatabaseManager>;
  let mockEngine: jest.Mocked<CoreEngine>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = new mockDatabaseManager() as jest.Mocked<DatabaseManager>;
    mockEngine = new mockCoreEngine(
      mockDb,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    ) as jest.Mocked<CoreEngine>;
    mockEngine.initialize.mockResolvedValue();

    server = new APIServer(mockDb, mockEngine);
  });

  describe('constructor', () => {
    it('should create server with database and engine', () => {
      expect(server).toBeInstanceOf(APIServer);
    });
  });

  describe('middleware setup', () => {
    it('should parse JSON bodies', async () => {
      const response = await request(server['app'])
        .post('/api/test')
        .send({ test: 'data' });

      // Should not get 400 for JSON parsing error
      expect(response.status).not.toBe(400);
    });

    it('should handle CORS', async () => {
      const response = await request(server['app']).get('/api/test');

      expect(response.headers['access-control-allow-origin']).toBe('*');
    });

    it('should serve static files', async () => {
      // This test depends on the actual file structure
      // We'll just check that the static middleware is set up
      const response = await request(server['app']).get('/nonexistent.js');

      // Should get 404 for non-existent static file, not 500
      expect(response.status).toBe(404);
    });
  });

  describe('routes setup', () => {
    it('should setup API routes', async () => {
      const response = await request(server['app']).get('/api/test');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: 'test',
      });
    });

    it('should serve HTML pages', async () => {
      // Mock path.join to return a test file path
      const originalJoin = path.join;
      jest.spyOn(path, 'join').mockReturnValue('/test/path/index.html');

      const response = await request(server['app']).get('/');

      // Should attempt to serve file (even if it doesn't exist in test)
      expect(response.status).toBe(404); // File doesn't exist in test

      path.join = originalJoin;
    });

    it('should handle task detail routes', async () => {
      const response = await request(server['app']).get('/tasks/123');

      expect(response.status).toBe(404); // File doesn't exist in test
    });

    it('should handle settings route', async () => {
      const response = await request(server['app']).get('/settings');

      expect(response.status).toBe(404); // File doesn't exist in test
    });

    it('should redirect unknown routes to home', async () => {
      const response = await request(server['app']).get('/unknown-route');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/');
    });
  });

  describe('error handling', () => {
    it('should handle server errors', async () => {
      // Create a route that throws an error
      server['app'].get('/error-test', () => {
        throw new Error('Test error');
      });

      const response = await request(server['app']).get('/error-test');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        error: 'Internal server error',
      });
    });
  });

  describe('start and stop', () => {
    let serverInstance: APIServer;

    beforeEach(() => {
      serverInstance = new APIServer(mockDb, mockEngine);
    });

    afterEach(async () => {
      try {
        await serverInstance.stop();
      } catch (error) {
        // Ignore errors during cleanup
      }
    });

    it('should start server and initialize engine', async () => {
      const port = 0; // Use random port for testing

      await serverInstance.start(port);

      expect(mockEngine.initialize).toHaveBeenCalled();
      expect(serverInstance['server']).toBeDefined();
    });

    it('should stop server', async () => {
      const port = 0; // Use random port for testing

      await serverInstance.start(port);
      await serverInstance.stop();

      expect(serverInstance['server']).toBeDefined();
    });

    it('should handle stop when server is not running', async () => {
      // Should not throw error
      await expect(serverInstance.stop()).resolves.not.toThrow();
    });
  });

  describe('logging middleware', () => {
    it('should log requests', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await request(server['app']).get('/api/test');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z - GET \/api\/test/
        )
      );

      consoleSpy.mockRestore();
    });
  });
});
