import { 
  getGitHubRepoInfo, 
  createPullRequest, 
  addPullRequestComment, 
  getPullRequestComments 
} from '../github-cli-utils';
import { exec } from '../exec';

jest.mock('../exec');

const mockExec = exec as jest.MockedFunction<typeof exec>;

describe('GitHub CLI Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getGitHubRepoInfo', () => {
    it('should return repository info', async () => {
      mockExec.mockResolvedValue({
        stdout: '{"owner":"testuser","name":"testrepo","url":"https://github.com/testuser/testrepo"}\n',
        stderr: '',
        exitCode: 0,
      });

      const info = await getGitHubRepoInfo();

      expect(info).toEqual({
        owner: 'testuser',
        name: 'testrepo',
        url: 'https://github.com/testuser/testrepo',
      });
      expect(mockExec).toHaveBeenCalledWith('gh repo view --json owner,name,url');
    });

    it('should handle invalid JSON response', async () => {
      mockExec.mockResolvedValue({
        stdout: 'invalid json',
        stderr: '',
        exitCode: 0,
      });

      await expect(getGitHubRepoInfo()).rejects.toThrow();
    });

    it('should handle command failure', async () => {
      mockExec.mockRejectedValue(new Error('GitHub CLI not authenticated'));

      await expect(getGitHubRepoInfo()).rejects.toThrow('GitHub CLI not authenticated');
    });
  });

  describe('createPullRequest', () => {
    it('should create a pull request', async () => {
      mockExec.mockResolvedValue({
        stdout: 'https://github.com/testuser/testrepo/pull/123\n',
        stderr: '',
        exitCode: 0,
      });

      const url = await createPullRequest('Test PR', 'Test description', 'feature-branch', 'main');

      expect(url).toBe('https://github.com/testuser/testrepo/pull/123');
      expect(mockExec).toHaveBeenCalledWith(
        'gh pr create --title "Test PR" --body "Test description" --head feature-branch --base main'
      );
    });

    it('should handle special characters in title and body', async () => {
      mockExec.mockResolvedValue({
        stdout: 'https://github.com/testuser/testrepo/pull/124\n',
        stderr: '',
        exitCode: 0,
      });

      const url = await createPullRequest('Fix: "bug" with \\'quotes\\'', 'Description with\nnewlines', 'fix-branch', 'main');

      expect(url).toBe('https://github.com/testuser/testrepo/pull/124');
      expect(mockExec).toHaveBeenCalledWith(
        'gh pr create --title "Fix: \\"bug\\" with \'quotes\'" --body "Description with\nnewlines" --head fix-branch --base main'
      );
    });

    it('should handle PR creation failure', async () => {
      mockExec.mockRejectedValue(new Error('PR creation failed'));

      await expect(createPullRequest('Test', 'Description', 'branch', 'main')).rejects.toThrow('PR creation failed');
    });
  });

  describe('addPullRequestComment', () => {
    it('should add a comment to a pull request', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Comment added successfully\n',
        stderr: '',
        exitCode: 0,
      });

      await addPullRequestComment(123, 'Test comment');

      expect(mockExec).toHaveBeenCalledWith('gh pr comment 123 --body "Test comment"');
    });

    it('should handle comments with special characters', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Comment added successfully\n',
        stderr: '',
        exitCode: 0,
      });

      await addPullRequestComment(123, 'Comment with "quotes" and newlines\nSecond line');

      expect(mockExec).toHaveBeenCalledWith('gh pr comment 123 --body "Comment with \\"quotes\\" and newlines\nSecond line"');
    });

    it('should handle comment addition failure', async () => {
      mockExec.mockRejectedValue(new Error('Comment addition failed'));

      await expect(addPullRequestComment(123, 'Test comment')).rejects.toThrow('Comment addition failed');
    });
  });

  describe('getPullRequestComments', () => {
    it('should get pull request comments', async () => {
      const mockComments = [
        {
          id: 1,
          body: 'First comment',
          author: { login: 'user1' },
          createdAt: '2023-01-01T00:00:00Z',
        },
        {
          id: 2,
          body: 'Second comment',
          author: { login: 'user2' },
          createdAt: '2023-01-02T00:00:00Z',
        },
      ];

      mockExec.mockResolvedValue({
        stdout: JSON.stringify(mockComments),
        stderr: '',
        exitCode: 0,
      });

      const comments = await getPullRequestComments(123);

      expect(comments).toEqual(mockComments);
      expect(mockExec).toHaveBeenCalledWith('gh pr view 123 --json comments --jq .comments');
    });

    it('should handle empty comments', async () => {
      mockExec.mockResolvedValue({
        stdout: '[]',
        stderr: '',
        exitCode: 0,
      });

      const comments = await getPullRequestComments(123);

      expect(comments).toEqual([]);
    });

    it('should handle invalid JSON response', async () => {
      mockExec.mockResolvedValue({
        stdout: 'invalid json',
        stderr: '',
        exitCode: 0,
      });

      await expect(getPullRequestComments(123)).rejects.toThrow();
    });

    it('should handle command failure', async () => {
      mockExec.mockRejectedValue(new Error('Failed to get comments'));

      await expect(getPullRequestComments(123)).rejects.toThrow('Failed to get comments');
    });
  });
});
