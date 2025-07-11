import { 
  DEFAULT_CODING_PROMPT, 
  generateCommitMessage, 
  generateTaskSummary 
} from '../prompts';

describe('Prompts', () => {
  describe('DEFAULT_CODING_PROMPT', () => {
    it('should contain essential instructions', () => {
      expect(DEFAULT_CODING_PROMPT).toContain('You are a helpful coding assistant');
      expect(DEFAULT_CODING_PROMPT).toContain('analyze the repository');
      expect(DEFAULT_CODING_PROMPT).toContain('implement the requested changes');
      expect(DEFAULT_CODING_PROMPT).toContain('follow best practices');
    });

    it('should be a non-empty string', () => {
      expect(DEFAULT_CODING_PROMPT).toBeTruthy();
      expect(typeof DEFAULT_CODING_PROMPT).toBe('string');
      expect(DEFAULT_CODING_PROMPT.length).toBeGreaterThan(0);
    });
  });

  describe('generateCommitMessage', () => {
    it('should generate commit message prompt', () => {
      const changes = 'Added new authentication feature';
      const prompt = generateCommitMessage(changes);

      expect(prompt).toContain('Generate a concise commit message');
      expect(prompt).toContain(changes);
      expect(prompt).toContain('conventional commit format');
    });

    it('should handle empty changes', () => {
      const prompt = generateCommitMessage('');

      expect(prompt).toContain('Generate a concise commit message');
      expect(prompt).toContain('conventional commit format');
    });

    it('should handle multiline changes', () => {
      const changes = 'Added authentication\\nFixed bug\\nUpdated tests';
      const prompt = generateCommitMessage(changes);

      expect(prompt).toContain(changes);
      expect(prompt).toContain('conventional commit format');
    });
  });

  describe('generateTaskSummary', () => {
    it('should generate task summary prompt', () => {
      const task = 'Fix authentication bug in login module';
      const prompt = generateTaskSummary(task);

      expect(prompt).toContain('Generate a brief summary');
      expect(prompt).toContain(task);
      expect(prompt).toContain('what was accomplished');
    });

    it('should handle empty task', () => {
      const prompt = generateTaskSummary('');

      expect(prompt).toContain('Generate a brief summary');
      expect(prompt).toContain('what was accomplished');
    });

    it('should handle complex task descriptions', () => {
      const task = 'Implement OAuth2 authentication with JWT tokens and refresh token rotation';
      const prompt = generateTaskSummary(task);

      expect(prompt).toContain(task);
      expect(prompt).toContain('what was accomplished');
    });
  });
});
