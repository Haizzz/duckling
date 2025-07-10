import {
  filterComments,
  formatPRComments,
  formatReviewComments,
  processAllComments,
  CommentData,
  CommentProcessingOptions,
} from '../../utils/comment-processor';
import { logger } from '../../utils/logger';

// Mock logger
jest.mock('../../utils/logger');
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('comment-processor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('filterComments', () => {
    const mockComments: CommentData[] = [
      {
        user: { login: 'user1' },
        body: 'duckling fix this issue',
        created_at: '2023-01-01T12:00:00Z',
      },
      {
        user: { login: 'user2' },
        body: 'regular comment',
        created_at: '2023-01-01T13:00:00Z',
      },
      {
        user: { login: 'user3' },
        body: 'duckling please update',
        created_at: '2023-01-01T14:00:00Z',
      },
    ];

    it('should filter comments by prefix', () => {
      const options: CommentProcessingOptions = {
        commentPrefix: 'duckling',
        lastCommitTimestamp: null,
      };

      const result = filterComments(mockComments, options);

      expect(result).toHaveLength(2);
      expect(result[0].body).toBe('duckling fix this issue');
      expect(result[1].body).toBe('duckling please update');
    });

    it('should filter comments by timestamp', () => {
      const options: CommentProcessingOptions = {
        commentPrefix: 'duckling',
        lastCommitTimestamp: '2023-01-01T12:30:00Z',
      };

      const result = filterComments(mockComments, options);

      expect(result).toHaveLength(1);
      expect(result[0].body).toBe('duckling please update');
    });

    it('should handle comments with submitted_at instead of created_at', () => {
      const reviewComments: CommentData[] = [
        {
          user: { login: 'user1' },
          body: 'duckling review comment',
          created_at: '',
          submitted_at: '2023-01-01T12:00:00Z',
        },
      ];

      const options: CommentProcessingOptions = {
        commentPrefix: 'duckling',
        lastCommitTimestamp: null,
      };

      const result = filterComments(reviewComments, options);

      expect(result).toHaveLength(1);
      expect(result[0].body).toBe('duckling review comment');
    });

    it('should handle empty comment body', () => {
      const commentsWithEmpty: CommentData[] = [
        {
          user: { login: 'user1' },
          body: '',
          created_at: '2023-01-01T12:00:00Z',
        },
      ];

      const options: CommentProcessingOptions = {
        commentPrefix: 'duckling',
        lastCommitTimestamp: null,
      };

      const result = filterComments(commentsWithEmpty, options);

      expect(result).toHaveLength(0);
    });

    it('should log filtering information', () => {
      const options: CommentProcessingOptions = {
        commentPrefix: 'duckling',
        lastCommitTimestamp: '2023-01-01T12:30:00Z',
      };

      filterComments(mockComments, options);

      expect(mockLogger.info).toHaveBeenCalledTimes(3);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Comment by user1')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("starts with 'duckling': true")
      );
    });
  });

  describe('formatPRComments', () => {
    it('should format PR comments correctly', () => {
      const comments: CommentData[] = [
        {
          user: { login: 'user1' },
          body: 'duckling fix this issue',
          created_at: '2023-01-01T12:00:00Z',
        },
        {
          user: { login: 'user2' },
          body: 'duckling please update',
          created_at: '2023-01-01T13:00:00Z',
        },
      ];

      const result = formatPRComments(comments);

      expect(result).toEqual([
        'Comment by user1:\nduckling fix this issue',
        'Comment by user2:\nduckling please update',
      ]);
    });

    it('should handle empty comments', () => {
      const result = formatPRComments([]);
      expect(result).toEqual([]);
    });
  });

  describe('formatReviewComments', () => {
    it('should format review comments with all fields', () => {
      const comments: CommentData[] = [
        {
          user: { login: 'reviewer1' },
          body: 'duckling needs improvement',
          created_at: '2023-01-01T12:00:00Z',
          state: 'CHANGES_REQUESTED',
          path: 'src/file.ts',
          line: 10,
          diff_hunk: '@@ -5,6 +5,7 @@',
        },
      ];

      const result = formatReviewComments(comments);

      expect(result).toEqual([
        'Review by reviewer1 (CHANGES_REQUESTED):\nFile: src/file.ts\nLine: 10\nContext: @@ -5,6 +5,7 @@\nduckling needs improvement',
      ]);
    });

    it('should format review comments without optional fields', () => {
      const comments: CommentData[] = [
        {
          user: { login: 'reviewer1' },
          body: 'duckling looks good',
          created_at: '2023-01-01T12:00:00Z',
        },
      ];

      const result = formatReviewComments(comments);

      expect(result).toEqual(['Review by reviewer1:\nduckling looks good']);
    });

    it('should handle empty body', () => {
      const comments: CommentData[] = [
        {
          user: { login: 'reviewer1' },
          body: '',
          created_at: '2023-01-01T12:00:00Z',
          state: 'APPROVED',
        },
      ];

      const result = formatReviewComments(comments);

      expect(result).toEqual(['Review by reviewer1 (APPROVED):']);
    });
  });

  describe('processAllComments', () => {
    it('should process both PR and review comments', () => {
      const prComments: CommentData[] = [
        {
          user: { login: 'user1' },
          body: 'duckling fix this',
          created_at: '2023-01-01T12:00:00Z',
        },
      ];

      const reviewComments: CommentData[] = [
        {
          user: { login: 'reviewer1' },
          body: 'duckling needs changes',
          created_at: '2023-01-01T13:00:00Z',
          state: 'CHANGES_REQUESTED',
        },
      ];

      const options: CommentProcessingOptions = {
        commentPrefix: 'duckling',
        lastCommitTimestamp: null,
      };

      const result = processAllComments(prComments, reviewComments, options);

      expect(result).toEqual([
        'Comment by user1:\nduckling fix this',
        'Review by reviewer1 (CHANGES_REQUESTED):\nduckling needs changes',
      ]);
    });

    it('should return empty array when no comments match', () => {
      const prComments: CommentData[] = [
        {
          user: { login: 'user1' },
          body: 'regular comment',
          created_at: '2023-01-01T12:00:00Z',
        },
      ];

      const reviewComments: CommentData[] = [];

      const options: CommentProcessingOptions = {
        commentPrefix: 'duckling',
        lastCommitTimestamp: null,
      };

      const result = processAllComments(prComments, reviewComments, options);

      expect(result).toEqual([]);
    });

    it('should filter by timestamp correctly', () => {
      const prComments: CommentData[] = [
        {
          user: { login: 'user1' },
          body: 'duckling old comment',
          created_at: '2023-01-01T10:00:00Z',
        },
        {
          user: { login: 'user2' },
          body: 'duckling new comment',
          created_at: '2023-01-01T14:00:00Z',
        },
      ];

      const reviewComments: CommentData[] = [];

      const options: CommentProcessingOptions = {
        commentPrefix: 'duckling',
        lastCommitTimestamp: '2023-01-01T12:00:00Z',
      };

      const result = processAllComments(prComments, reviewComments, options);

      expect(result).toEqual(['Comment by user2:\nduckling new comment']);
    });
  });
});
