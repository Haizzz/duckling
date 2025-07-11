import { validateAndGetRepoInfo } from '../git-utils';
import { simpleGit } from 'simple-git';
import { logger } from '../logger';

jest.mock('simple-git');
jest.mock('../logger');

const mockSimpleGit = simpleGit as jest.MockedFunction<typeof simpleGit>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('Git Utils', () => {
  let mockGit: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGit = {
      checkIsRepo: jest.fn(),
      getRemotes: jest.fn(),
    };
    mockSimpleGit.mockReturnValue(mockGit);
  });

  describe('validateAndGetRepoInfo', () => {
    it('should validate and return repo info for valid GitHub repository', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.getRemotes.mockResolvedValue([
        {
          name: 'origin',
          refs: {
            fetch: 'https://github.com/testuser/testrepo.git',
          },
        },
      ]);

      const result = await validateAndGetRepoInfo('/test/path');

      expect(result).toEqual({
        repoPath: '/test/path',
        remoteUrl: 'https://github.com/testuser/testrepo',
        owner: 'testuser',
        name: 'testrepo',
      });
      expect(mockLogger.info).toHaveBeenCalledWith('Git repository validated: testuser/testrepo');
    });

    it('should handle SSH GitHub URL', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.getRemotes.mockResolvedValue([
        {
          name: 'origin',
          refs: {
            fetch: 'git@github.com:testuser/testrepo.git',
          },
        },
      ]);

      const result = await validateAndGetRepoInfo('/test/path');

      expect(result).toEqual({
        repoPath: '/test/path',
        remoteUrl: 'git@github.com:testuser/testrepo',
        owner: 'testuser',
        name: 'testrepo',
      });
    });

    it('should throw error for non-git repository', async () => {
      mockGit.checkIsRepo.mockResolvedValue(false);

      await expect(validateAndGetRepoInfo('/test/path')).rejects.toThrow(
        'Directory /test/path is not a git repository. Please run duckling from within a git repository.'
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Git repository validation failed: Directory /test/path is not a git repository. Please run duckling from within a git repository.'
      );
    });

    it('should throw error when no origin remote found', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.getRemotes.mockResolvedValue([]);

      await expect(validateAndGetRepoInfo('/test/path')).rejects.toThrow(
        'No origin remote found. Please ensure the repository has a GitHub origin remote.'
      );
    });

    it('should throw error when origin has no fetch URL', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.getRemotes.mockResolvedValue([
        {
          name: 'origin',
          refs: {},
        },
      ]);

      await expect(validateAndGetRepoInfo('/test/path')).rejects.toThrow(
        'No origin remote found. Please ensure the repository has a GitHub origin remote.'
      );
    });

    it('should throw error for non-GitHub remote', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.getRemotes.mockResolvedValue([
        {
          name: 'origin',
          refs: {
            fetch: 'https://gitlab.com/testuser/testrepo.git',
          },
        },
      ]);

      await expect(validateAndGetRepoInfo('/test/path')).rejects.toThrow(
        'Origin remote is not a GitHub repository. Please ensure you are working with a GitHub repository.'
      );
    });

    it('should handle git errors', async () => {
      mockGit.checkIsRepo.mockRejectedValue(new Error('Git error'));

      await expect(validateAndGetRepoInfo('/test/path')).rejects.toThrow('Git error');
      expect(mockLogger.error).toHaveBeenCalledWith('Git repository validation failed: Git error');
    });
  });
});
