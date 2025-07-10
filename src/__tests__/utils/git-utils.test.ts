import { validateAndGetRepoInfo } from '../../utils/git-utils';
import { simpleGit } from 'simple-git';
import { logger } from '../../utils/logger';

// Mock simple-git
jest.mock('simple-git');
const mockSimpleGit = simpleGit as jest.MockedFunction<typeof simpleGit>;

// Mock logger
jest.mock('../../utils/logger');
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('git-utils', () => {
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
    it('should return valid git repo info', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.getRemotes.mockResolvedValue([
        {
          name: 'origin',
          refs: {
            fetch: 'https://github.com/owner/repo.git',
          },
        },
      ]);

      const result = await validateAndGetRepoInfo('/test/path');

      expect(result).toEqual({
        repoPath: '/test/path',
        remoteUrl: 'https://github.com/owner/repo',
        owner: 'owner',
        name: 'repo',
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Git repository validated: owner/repo'
      );
    });

    it('should handle SSH GitHub URLs', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.getRemotes.mockResolvedValue([
        {
          name: 'origin',
          refs: {
            fetch: 'git@github.com:owner/repo.git',
          },
        },
      ]);

      const result = await validateAndGetRepoInfo('/test/path');

      expect(result).toEqual({
        repoPath: '/test/path',
        remoteUrl: 'git@github.com:owner/repo',
        owner: 'owner',
        name: 'repo',
      });
    });

    it('should handle GitHub URLs without .git extension', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.getRemotes.mockResolvedValue([
        {
          name: 'origin',
          refs: {
            fetch: 'https://github.com/owner/repo',
          },
        },
      ]);

      const result = await validateAndGetRepoInfo('/test/path');

      expect(result).toEqual({
        repoPath: '/test/path',
        remoteUrl: 'https://github.com/owner/repo',
        owner: 'owner',
        name: 'repo',
      });
    });

    it('should throw error if not a git repository', async () => {
      mockGit.checkIsRepo.mockResolvedValue(false);

      await expect(validateAndGetRepoInfo('/test/path')).rejects.toThrow(
        'Directory /test/path is not a git repository. Please run duckling from within a git repository.'
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Git repository validation failed: Directory /test/path is not a git repository. Please run duckling from within a git repository.'
      );
    });

    it('should throw error if no origin remote found', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.getRemotes.mockResolvedValue([]);

      await expect(validateAndGetRepoInfo('/test/path')).rejects.toThrow(
        'No origin remote found. Please ensure the repository has a GitHub origin remote.'
      );
    });

    it('should throw error if origin remote has no fetch URL', async () => {
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

    it('should throw error if remote is not a GitHub repository', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.getRemotes.mockResolvedValue([
        {
          name: 'origin',
          refs: {
            fetch: 'https://gitlab.com/owner/repo.git',
          },
        },
      ]);

      await expect(validateAndGetRepoInfo('/test/path')).rejects.toThrow(
        'Origin remote is not a GitHub repository. Please ensure you are working with a GitHub repository.'
      );
    });

    it('should handle git operation errors', async () => {
      mockGit.checkIsRepo.mockRejectedValue(new Error('Git operation failed'));

      await expect(validateAndGetRepoInfo('/test/path')).rejects.toThrow(
        'Git operation failed'
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Git repository validation failed: Git operation failed'
      );
    });

    it('should handle complex GitHub URLs', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.getRemotes.mockResolvedValue([
        {
          name: 'origin',
          refs: {
            fetch: 'https://github.com/organization-name/repo-with-hyphens.git',
          },
        },
      ]);

      const result = await validateAndGetRepoInfo('/test/path');

      expect(result).toEqual({
        repoPath: '/test/path',
        remoteUrl: 'https://github.com/organization-name/repo-with-hyphens',
        owner: 'organization-name',
        name: 'repo-with-hyphens',
      });
    });
  });
});
