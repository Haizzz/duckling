// Jest setup file for global test configuration
import fs from 'fs';
import path from 'path';

// Mock environment variables
process.env.NODE_ENV = 'test';

// Create test directory if it doesn't exist
const testDir = path.join(__dirname, '../../test-temp');
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

// Cleanup function
afterEach(() => {
  jest.clearAllMocks();
});

// Global test timeout
jest.setTimeout(10000);
