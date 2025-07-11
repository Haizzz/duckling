import { CodingManager } from '../coding-manager';
import { exec } from '../../utils/exec';
import { logger } from '../../utils/logger';

jest.mock('../../utils/exec');
jest.mock('../../utils/logger');

const mockExec = exec as jest.MockedFunction<typeof exec>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('CodingManager', () => {
  let codingManager: CodingManager;

  beforeEach(() => {
    jest.clearAllMocks();
    codingManager = new CodingManager();
  });

  describe('executeTask', () => {
    it('should execute task with amp tool', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Task completed successfully',
        stderr: '',
        exitCode: 0,
      });

      await codingManager.executeTask('Fix authentication bug', 'amp', 1);

      expect(mockExec).toHaveBeenCalledWith('amp "Fix authentication bug"', { cwd: process.cwd() });
      expect(mockLogger.info).toHaveBeenCalledWith('Starting coding task with amp', '1');
      expect(mockLogger.info).toHaveBeenCalledWith('Coding task completed successfully', '1');
    });

    it('should execute task with openai tool', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Task completed with OpenAI',
        stderr: '',
        exitCode: 0,
      });

      await codingManager.executeTask('Add new feature', 'openai', 2);

      expect(mockExec).toHaveBeenCalledWith('openai "Add new feature"', { cwd: process.cwd() });
      expect(mockLogger.info).toHaveBeenCalledWith('Starting coding task with openai', '2');
      expect(mockLogger.info).toHaveBeenCalledWith('Coding task completed successfully', '2');
    });

    it('should handle task execution failure', async () => {
      const error = new Error('Command failed');
      mockExec.mockRejectedValue(error);

      await expect(codingManager.executeTask('Failing task', 'amp', 1)).rejects.toThrow('Command failed');

      expect(mockLogger.error).toHaveBeenCalledWith('Coding task failed: Command failed', '1');
    });

    it('should handle invalid tool', async () => {
      await expect(codingManager.executeTask('Test task', 'invalid-tool' as any, 1)).rejects.toThrow('Unsupported coding tool: invalid-tool');
    });

    it('should execute task with custom working directory', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Task completed',
        stderr: '',
        exitCode: 0,
      });

      await codingManager.executeTask('Test task', 'amp', 1, '/custom/path');

      expect(mockExec).toHaveBeenCalledWith('amp "Test task"', { cwd: '/custom/path' });
    });

    it('should handle empty task description', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Empty task completed',
        stderr: '',
        exitCode: 0,
      });

      await codingManager.executeTask('', 'amp', 1);

      expect(mockExec).toHaveBeenCalledWith('amp ""', { cwd: process.cwd() });
    });

    it('should handle task with special characters', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Special task completed',
        stderr: '',
        exitCode: 0,
      });

      await codingManager.executeTask('Fix "bug" with \\'quotes\\'', 'amp', 1);

      expect(mockExec).toHaveBeenCalledWith('amp "Fix \\"bug\\" with \'quotes\'"', { cwd: process.cwd() });
    });

    it('should log stderr output as warning', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Task completed',
        stderr: 'Some warnings occurred',
        exitCode: 0,
      });

      await codingManager.executeTask('Test task', 'amp', 1);

      expect(mockLogger.warn).toHaveBeenCalledWith('Coding task stderr: Some warnings occurred', '1');
    });

    it('should handle non-zero exit code', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Task output',
        stderr: 'Error occurred',
        exitCode: 1,
      });

      await expect(codingManager.executeTask('Failing task', 'amp', 1)).rejects.toThrow('Coding task failed with exit code 1');
    });
  });

  describe('isToolAvailable', () => {
    it('should check if amp tool is available', async () => {
      mockExec.mockResolvedValue({
        stdout: 'amp version 1.0.0',
        stderr: '',
        exitCode: 0,
      });

      const result = await codingManager.isToolAvailable('amp');

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('amp --version');
    });

    it('should check if openai tool is available', async () => {
      mockExec.mockResolvedValue({
        stdout: 'openai version 1.0.0',
        stderr: '',
        exitCode: 0,
      });

      const result = await codingManager.isToolAvailable('openai');

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('openai --version');
    });

    it('should return false if tool is not available', async () => {
      mockExec.mockRejectedValue(new Error('Command not found'));

      const result = await codingManager.isToolAvailable('amp');

      expect(result).toBe(false);
    });

    it('should handle invalid tool for availability check', async () => {
      const result = await codingManager.isToolAvailable('invalid-tool' as any);

      expect(result).toBe(false);
    });
  });

  describe('getSupportedTools', () => {
    it('should return list of supported tools', () => {
      const tools = codingManager.getSupportedTools();

      expect(tools).toEqual(['amp', 'openai']);
    });
  });

  describe('validateTool', () => {
    it('should validate amp tool', () => {
      expect(() => codingManager.validateTool('amp')).not.toThrow();
    });

    it('should validate openai tool', () => {
      expect(() => codingManager.validateTool('openai')).not.toThrow();
    });

    it('should throw error for invalid tool', () => {
      expect(() => codingManager.validateTool('invalid-tool' as any)).toThrow('Unsupported coding tool: invalid-tool');
    });
  });
});
