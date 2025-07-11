import { 
  extractDucklingComments, 
  shouldProcessComment, 
  processComment 
} from '../comment-processor';

describe('Comment Processor', () => {
  describe('extractDucklingComments', () => {
    it('should extract duckling comments with default prefix', () => {
      const comments = [
        {
          id: 1,
          body: 'duckling: please fix the bug',
          author: { login: 'user1' },
          createdAt: '2023-01-01T00:00:00Z',
        },
        {
          id: 2,
          body: 'This is a regular comment',
          author: { login: 'user2' },
          createdAt: '2023-01-02T00:00:00Z',
        },
        {
          id: 3,
          body: 'duckling: add new feature',
          author: { login: 'user3' },
          createdAt: '2023-01-03T00:00:00Z',
        },
      ];

      const result = extractDucklingComments(comments);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 1,
        body: 'duckling: please fix the bug',
        author: { login: 'user1' },
        createdAt: '2023-01-01T00:00:00Z',
      });
      expect(result[1]).toEqual({
        id: 3,
        body: 'duckling: add new feature',
        author: { login: 'user3' },
        createdAt: '2023-01-03T00:00:00Z',
      });
    });

    it('should extract comments with custom prefix', () => {
      const comments = [
        {
          id: 1,
          body: 'bot: please fix the bug',
          author: { login: 'user1' },
          createdAt: '2023-01-01T00:00:00Z',
        },
        {
          id: 2,
          body: 'duckling: should be ignored',
          author: { login: 'user2' },
          createdAt: '2023-01-02T00:00:00Z',
        },
      ];

      const result = extractDucklingComments(comments, 'bot');

      expect(result).toHaveLength(1);
      expect(result[0].body).toBe('bot: please fix the bug');
    });

    it('should handle case-insensitive matching', () => {
      const comments = [
        {
          id: 1,
          body: 'DUCKLING: uppercase comment',
          author: { login: 'user1' },
          createdAt: '2023-01-01T00:00:00Z',
        },
        {
          id: 2,
          body: 'Duckling: title case comment',
          author: { login: 'user2' },
          createdAt: '2023-01-02T00:00:00Z',
        },
      ];

      const result = extractDucklingComments(comments);

      expect(result).toHaveLength(2);
    });

    it('should handle comments with prefix in middle of text', () => {
      const comments = [
        {
          id: 1,
          body: 'Please duckling: fix this bug',
          author: { login: 'user1' },
          createdAt: '2023-01-01T00:00:00Z',
        },
        {
          id: 2,
          body: 'duckling: at the start',
          author: { login: 'user2' },
          createdAt: '2023-01-02T00:00:00Z',
        },
      ];

      const result = extractDucklingComments(comments);

      expect(result).toHaveLength(2);
    });

    it('should handle empty comments array', () => {
      const result = extractDucklingComments([]);

      expect(result).toHaveLength(0);
    });

    it('should handle comments without body', () => {
      const comments = [
        {
          id: 1,
          body: '',
          author: { login: 'user1' },
          createdAt: '2023-01-01T00:00:00Z',
        },
        {
          id: 2,
          body: null as any,
          author: { login: 'user2' },
          createdAt: '2023-01-02T00:00:00Z',
        },
      ];

      const result = extractDucklingComments(comments);

      expect(result).toHaveLength(0);
    });
  });

  describe('shouldProcessComment', () => {
    it('should return true for new comments', () => {
      const result = shouldProcessComment(
        { id: 1, body: 'duckling: test', author: { login: 'user1' }, createdAt: '2023-01-01T00:00:00Z' },
        []
      );

      expect(result).toBe(true);
    });

    it('should return false for already processed comments', () => {
      const comment = { id: 1, body: 'duckling: test', author: { login: 'user1' }, createdAt: '2023-01-01T00:00:00Z' };
      const processed = [1, 2, 3];

      const result = shouldProcessComment(comment, processed);

      expect(result).toBe(false);
    });

    it('should return true for comments not in processed list', () => {
      const comment = { id: 4, body: 'duckling: test', author: { login: 'user1' }, createdAt: '2023-01-01T00:00:00Z' };
      const processed = [1, 2, 3];

      const result = shouldProcessComment(comment, processed);

      expect(result).toBe(true);
    });
  });

  describe('processComment', () => {
    it('should extract task from comment body', () => {
      const comment = {
        id: 1,
        body: 'duckling: please fix the authentication bug in the login module',
        author: { login: 'user1' },
        createdAt: '2023-01-01T00:00:00Z',
      };

      const result = processComment(comment);

      expect(result).toEqual({
        commentId: 1,
        task: 'please fix the authentication bug in the login module',
        author: 'user1',
        createdAt: '2023-01-01T00:00:00Z',
      });
    });

    it('should handle comment with custom prefix', () => {
      const comment = {
        id: 2,
        body: 'bot: add new feature to the dashboard',
        author: { login: 'user2' },
        createdAt: '2023-01-02T00:00:00Z',
      };

      const result = processComment(comment, 'bot');

      expect(result).toEqual({
        commentId: 2,
        task: 'add new feature to the dashboard',
        author: 'user2',
        createdAt: '2023-01-02T00:00:00Z',
      });
    });

    it('should handle comment with multiple colons', () => {
      const comment = {
        id: 3,
        body: 'duckling: fix the bug: it should work correctly',
        author: { login: 'user3' },
        createdAt: '2023-01-03T00:00:00Z',
      };

      const result = processComment(comment);

      expect(result).toEqual({
        commentId: 3,
        task: 'fix the bug: it should work correctly',
        author: 'user3',
        createdAt: '2023-01-03T00:00:00Z',
      });
    });

    it('should handle comment without colon', () => {
      const comment = {
        id: 4,
        body: 'duckling please fix this',
        author: { login: 'user4' },
        createdAt: '2023-01-04T00:00:00Z',
      };

      const result = processComment(comment);

      expect(result).toEqual({
        commentId: 4,
        task: 'duckling please fix this',
        author: 'user4',
        createdAt: '2023-01-04T00:00:00Z',
      });
    });

    it('should trim whitespace from task', () => {
      const comment = {
        id: 5,
        body: 'duckling:   fix the spacing issue   ',
        author: { login: 'user5' },
        createdAt: '2023-01-05T00:00:00Z',
      };

      const result = processComment(comment);

      expect(result).toEqual({
        commentId: 5,
        task: 'fix the spacing issue',
        author: 'user5',
        createdAt: '2023-01-05T00:00:00Z',
      });
    });

    it('should handle empty task after prefix', () => {
      const comment = {
        id: 6,
        body: 'duckling:',
        author: { login: 'user6' },
        createdAt: '2023-01-06T00:00:00Z',
      };

      const result = processComment(comment);

      expect(result).toEqual({
        commentId: 6,
        task: '',
        author: 'user6',
        createdAt: '2023-01-06T00:00:00Z',
      });
    });
  });
});
