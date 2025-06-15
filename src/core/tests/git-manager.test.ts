jest.mock('simple-git');
jest.mock('../openai-manager');

import { GitManager } from '../git-manager';
import { simpleGit } from 'simple-git';
import { OpenAIManager } from '../openai-manager';
import { createMockInstance } from '../../utils/test-utils';

interface MockGit {
  fetch: jest.Mock;
  checkout: jest.Mock;
  pull: jest.Mock;
  checkoutLocalBranch: jest.Mock;
  branchLocal: jest.Mock;
  add: jest.Mock;
  status: jest.Mock;
  commit: jest.Mock;
  push: jest.Mock;
  log: jest.Mock;
  diff: jest.Mock;
}

describe('GitManager', () => {
  let gitManager: GitManager;
  let mockDb: any; // Simplified for testing - only using subset of DatabaseManager methods
  let mockGit: MockGit;
  let mockOpenAIManager: jest.Mocked<OpenAIManager>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDb = {
      getSetting: jest.fn(),
      setSetting: jest.fn(),
      addTaskLog: jest.fn(),
    };

    mockGit = {
      fetch: jest.fn(),
      checkout: jest.fn(),
      pull: jest.fn(),
      checkoutLocalBranch: jest.fn(),
      branchLocal: jest.fn(),
      add: jest.fn(),
      status: jest.fn(),
      commit: jest.fn(),
      push: jest.fn(),
      log: jest.fn(),
      diff: jest.fn(),
    };

    (simpleGit as jest.Mock).mockReturnValue(mockGit);

    mockOpenAIManager = createMockInstance(OpenAIManager);

    (OpenAIManager as jest.Mock).mockImplementation(() => mockOpenAIManager);

    gitManager = new GitManager(mockDb, '/test/repo', mockOpenAIManager);
  });

  describe('getLastCommitTimestamp', () => {
    it('returns hash from latest commit when log contains data', async () => {
      mockGit.log.mockResolvedValue({
        latest: { hash: '2023-01-01T10:00:00Z' },
      });

      const result = await gitManager.getLastCommitTimestamp('main');

      expect(result).toBe('2023-01-01T10:00:00Z');
      expect(mockGit.log).toHaveBeenCalledWith(['-1', '--format=%cI']);
    });

    it('throws error when no commits found', async () => {
      mockGit.log.mockResolvedValue({});

      await expect(gitManager.getLastCommitTimestamp('main')).rejects.toThrow(
        'No commits found for branch main'
      );
    });
  });

  describe('createAndCheckoutBranch', () => {
    beforeEach(() => {
      mockDb.getSetting.mockImplementation((key: string) => {
        const settings: Record<string, any> = {
          baseBranch: 'main',
          branchPrefix: 'duckling-',
        };
        return settings[key] || null;
      });
    });

    it('creates new branch with prefix and base name when branch available', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: [] });
      mockGit.fetch.mockResolvedValue(undefined);
      mockGit.checkout.mockResolvedValue(undefined);
      mockGit.pull.mockResolvedValue(undefined);
      mockGit.checkoutLocalBranch.mockResolvedValue(undefined);

      const result = await gitManager.createAndCheckoutBranch('feature', 123);

      expect(result).toBe('duckling-feature');
      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'main');
      expect(mockGit.checkout).toHaveBeenCalledWith('main');
      expect(mockGit.pull).toHaveBeenCalledWith('origin', 'main');
      expect(mockGit.checkoutLocalBranch).toHaveBeenCalledWith(
        'duckling-feature'
      );
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message: '🌱 Creating and checking out new branch: duckling-feature',
      });
    });

    it('adds counter to branch name when original name already exists', async () => {
      mockGit.branchLocal
        .mockResolvedValueOnce({ all: ['duckling-feature'] })
        .mockResolvedValueOnce({
          all: ['duckling-feature', 'duckling-feature-1'],
        })
        .mockResolvedValueOnce({
          all: ['duckling-feature', 'duckling-feature-1'],
        });
      mockGit.fetch.mockResolvedValue(undefined);
      mockGit.checkout.mockResolvedValue(undefined);
      mockGit.pull.mockResolvedValue(undefined);
      mockGit.checkoutLocalBranch.mockResolvedValue(undefined);

      const result = await gitManager.createAndCheckoutBranch('feature', 123);

      expect(result).toBe('duckling-feature-2');
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message:
          'ℹ️ Branch name adjusted to avoid conflicts: duckling-feature-2',
      });
    });

    it('uses custom branch prefix when provided', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: [] });
      mockGit.fetch.mockResolvedValue(undefined);
      mockGit.checkout.mockResolvedValue(undefined);
      mockGit.pull.mockResolvedValue(undefined);
      mockGit.checkoutLocalBranch.mockResolvedValue(undefined);

      const result = await gitManager.createAndCheckoutBranch(
        'feature',
        123,
        'custom-'
      );

      expect(result).toBe('custom-feature');
      expect(mockGit.checkoutLocalBranch).toHaveBeenCalledWith(
        'custom-feature'
      );
    });

    it('logs progress messages during branch creation process', async () => {
      mockGit.branchLocal.mockResolvedValue({ all: [] });
      mockGit.fetch.mockResolvedValue(undefined);
      mockGit.checkout.mockResolvedValue(undefined);
      mockGit.pull.mockResolvedValue(undefined);
      mockGit.checkoutLocalBranch.mockResolvedValue(undefined);

      await gitManager.createAndCheckoutBranch('feature', 123);

      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message: '📥 Fetching latest changes from main...',
      });
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message: '🔄 Switching to main and pulling latest...',
      });
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message:
          "🔍 Checking if branch name 'duckling-feature' is available...",
      });
    });
  });

  describe('branchExists', () => {
    it('returns true when branch exists in local branches', async () => {
      mockGit.branchLocal.mockResolvedValue({
        all: ['main', 'feature-branch', 'duckling-test'],
      });

      const result = await gitManager.branchExists('feature-branch');

      expect(result).toBe(true);
      expect(mockGit.branchLocal).toHaveBeenCalledTimes(1);
    });

    it('returns false when branch does not exist in local branches', async () => {
      mockGit.branchLocal.mockResolvedValue({
        all: ['main', 'other-branch'],
      });

      const result = await gitManager.branchExists('nonexistent-branch');

      expect(result).toBe(false);
    });

    it('returns false when branchLocal throws error', async () => {
      mockGit.branchLocal.mockRejectedValue(new Error('Git error'));

      const result = await gitManager.branchExists('any-branch');

      expect(result).toBe(false);
    });
  });

  describe('commitChanges', () => {
    beforeEach(() => {
      mockDb.getSetting.mockImplementation((key: string) => {
        const settings: Record<string, any> = {
          commitSuffix: ' [quack]',
        };
        return settings[key] || ' [quack]';
      });
    });

    it('commits changes with generated message when files are staged', async () => {
      mockGit.add.mockResolvedValue(undefined);
      mockGit.status.mockResolvedValue({
        files: [{ path: 'file1.ts' }, { path: 'file2.js' }],
        modified: ['file1.ts'],
        created: ['file2.js'],
        deleted: [],
      });
      mockOpenAIManager.generateCommitMessage.mockResolvedValue(
        'Add new features'
      );
      mockGit.commit.mockResolvedValue(undefined);

      await gitManager.commitChanges('Create new feature', 123);

      expect(mockGit.add).toHaveBeenCalledWith('.');
      expect(mockOpenAIManager.generateCommitMessage).toHaveBeenCalledWith(
        'Create new feature',
        ['file1.ts', 'file2.js'],
        123
      );
      expect(mockGit.commit).toHaveBeenCalledWith('Add new features [quack]');
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message: '💾 Committing with message: "Add new features [quack]"',
      });
    });

    it('throws error when no changes to commit', async () => {
      mockGit.add.mockResolvedValue(undefined);
      mockGit.status.mockResolvedValue({
        files: [],
        modified: [],
        created: [],
        deleted: [],
      });

      await expect(
        gitManager.commitChanges('Task description', 123)
      ).rejects.toThrow('No changes to commit');

      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'error',
        message: '❌ No changes to commit found',
      });
    });

    it('does not duplicate suffix when message already ends with it', async () => {
      mockGit.add.mockResolvedValue(undefined);
      mockGit.status.mockResolvedValue({
        files: [{ path: 'file1.ts' }],
        modified: ['file1.ts'],
        created: [],
        deleted: [],
      });
      mockOpenAIManager.generateCommitMessage.mockResolvedValue(
        'Fix bug [quack]'
      );
      mockGit.commit.mockResolvedValue(undefined);

      await gitManager.commitChanges('Fix bug', 123);

      expect(mockGit.commit).toHaveBeenCalledWith('Fix bug [quack]');
    });

    it('includes renamed files in changed files list', async () => {
      mockGit.add.mockResolvedValue(undefined);
      mockGit.status.mockResolvedValue({
        files: [{ path: 'new-file.ts' }],
        modified: ['new-file.ts'],
        created: [],
        deleted: [],
        renamed: [{ from: 'old-file.ts', to: 'new-file.ts' }],
      });
      mockOpenAIManager.generateCommitMessage.mockResolvedValue('Rename file');
      mockGit.commit.mockResolvedValue(undefined);

      await gitManager.commitChanges('Rename file', 123);

      expect(mockOpenAIManager.generateCommitMessage).toHaveBeenCalledWith(
        'Rename file',
        ['new-file.ts'],
        123
      );
    });

    it('logs progress messages during commit process', async () => {
      mockGit.add.mockResolvedValue(undefined);
      mockGit.status.mockResolvedValue({
        files: [{ path: 'file1.ts' }],
        modified: ['file1.ts'],
        created: [],
        deleted: [],
      });
      mockOpenAIManager.generateCommitMessage.mockResolvedValue('Update file');
      mockGit.commit.mockResolvedValue(undefined);

      await gitManager.commitChanges('Update file', 123);

      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message: '📁 Adding all changes to staging area...',
      });
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message: '🔍 Checking for changes to commit...',
      });
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message: '📝 Found 1 changed files, generating commit message...',
      });
    });
  });

  describe('pushBranch', () => {
    it('pushes branch to origin and logs progress', async () => {
      mockGit.push.mockResolvedValue(undefined);

      await gitManager.pushBranch('feature-branch', 123);

      expect(mockGit.push).toHaveBeenCalledWith('origin', 'feature-branch');
      expect(mockDb.addTaskLog).toHaveBeenCalledWith({
        task_id: 123,
        level: 'info',
        message: "🚀 Pushing branch 'feature-branch' to origin...",
      });
    });

    it('handles push errors by retrying with withRetry mechanism', async () => {
      mockGit.push
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(undefined);

      await gitManager.pushBranch('feature-branch', 123);

      expect(mockGit.push).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCurrentBranch', () => {
    it('returns current branch from git status', async () => {
      mockGit.status.mockResolvedValue({ current: 'feature-branch' });

      const result = await gitManager.getCurrentBranch();

      expect(result).toBe('feature-branch');
      expect(mockGit.status).toHaveBeenCalledTimes(1);
    });

    it('returns main as default when no current branch', async () => {
      mockGit.status.mockResolvedValue({ current: null });

      const result = await gitManager.getCurrentBranch();

      expect(result).toBe('main');
    });
  });

  describe('switchToBranch', () => {
    it('fetches, checks out, and pulls branch with task logging', async () => {
      mockGit.fetch.mockResolvedValue(undefined);
      mockGit.checkout.mockResolvedValue(undefined);
      mockGit.pull.mockResolvedValue(undefined);

      await gitManager.switchToBranch('feature-branch', 123);

      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'feature-branch');
      expect(mockGit.checkout).toHaveBeenCalledWith('feature-branch');
      expect(mockGit.pull).toHaveBeenCalledWith('origin', 'feature-branch');
    });

    it('handles pull failure gracefully for local branches', async () => {
      mockGit.fetch.mockResolvedValue(undefined);
      mockGit.checkout.mockResolvedValue(undefined);
      mockGit.pull.mockRejectedValue(new Error('No upstream branch'));

      await expect(
        gitManager.switchToBranch('local-branch', 123)
      ).resolves.not.toThrow();

      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'local-branch');
      expect(mockGit.checkout).toHaveBeenCalledWith('local-branch');
    });

    it('works without task ID for non-logged operations', async () => {
      mockGit.fetch.mockResolvedValue(undefined);
      mockGit.checkout.mockResolvedValue(undefined);
      mockGit.pull.mockResolvedValue(undefined);

      await gitManager.switchToBranch('feature-branch');

      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'feature-branch');
      expect(mockGit.checkout).toHaveBeenCalledWith('feature-branch');
      expect(mockGit.pull).toHaveBeenCalledWith('origin', 'feature-branch');
    });
  });

  describe('fetchBranch', () => {
    it('fetches latest changes for specified branch', async () => {
      mockGit.fetch.mockResolvedValue(undefined);

      await gitManager.fetchBranch('feature-branch', 123);

      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'feature-branch');
    });

    it('works without task ID parameter', async () => {
      mockGit.fetch.mockResolvedValue(undefined);

      await gitManager.fetchBranch('feature-branch');

      expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'feature-branch');
    });
  });

  describe('getChangedFiles', () => {
    it('returns list of all changed files from git status', async () => {
      mockGit.status.mockResolvedValue({
        created: ['new-file.ts'],
        modified: ['existing-file.js'],
        deleted: ['old-file.txt'],
        renamed: [
          { from: 'old-name.ts', to: 'new-name.ts' },
          { from: 'another.js', to: null },
        ],
      });

      const result = await gitManager.getChangedFiles();

      expect(result).toEqual([
        'new-file.ts',
        'existing-file.js',
        'old-file.txt',
        'new-name.ts',
        'another.js',
      ]);
    });

    it('handles empty status with no changes', async () => {
      mockGit.status.mockResolvedValue({
        created: [],
        modified: [],
        deleted: [],
        renamed: [],
      });

      const result = await gitManager.getChangedFiles();

      expect(result).toEqual([]);
    });
  });

  describe('getDiff', () => {
    it('returns diff against origin/main when branch name provided', async () => {
      mockGit.diff.mockResolvedValue('diff content');

      const result = await gitManager.getDiff('feature-branch');

      expect(result).toBe('diff content');
      expect(mockGit.diff).toHaveBeenCalledWith([
        'origin/main...feature-branch',
      ]);
    });

    it('returns current working directory diff when no branch specified', async () => {
      mockGit.diff.mockResolvedValue('working directory diff');

      const result = await gitManager.getDiff();

      expect(result).toBe('working directory diff');
      expect(mockGit.diff).toHaveBeenCalledWith();
    });
  });

  describe('pullLatest', () => {
    it('pulls latest changes from specified branch', async () => {
      mockGit.pull.mockResolvedValue(undefined);

      await gitManager.pullLatest('develop', 123);

      expect(mockGit.pull).toHaveBeenCalledWith('origin', 'develop');
    });

    it('pulls from main branch by default when no branch specified', async () => {
      mockGit.pull.mockResolvedValue(undefined);

      await gitManager.pullLatest();

      expect(mockGit.pull).toHaveBeenCalledWith('origin', 'main');
    });

    it('works without task ID for non-logged operations', async () => {
      mockGit.pull.mockResolvedValue(undefined);

      await gitManager.pullLatest('main');

      expect(mockGit.pull).toHaveBeenCalledWith('origin', 'main');
    });
  });

  describe('error handling and retries', () => {
    it('retries operations when they fail temporarily', async () => {
      mockGit.fetch
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce(undefined);

      await gitManager.fetchBranch('feature-branch', 123);

      expect(mockGit.fetch).toHaveBeenCalledTimes(3);
    });

    it('throws error after maximum retries exceeded', async () => {
      mockGit.push.mockRejectedValue(new Error('Persistent error'));

      await expect(
        gitManager.pushBranch('feature-branch', 123)
      ).rejects.toThrow();

      expect(mockGit.push).toHaveBeenCalledTimes(3); // Default retry count
    });
  });
});
