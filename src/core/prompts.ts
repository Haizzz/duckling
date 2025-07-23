export const DEFAULT_CODING_PROMPT = `You are a senior software engineer.
1. **Understand Context**: First examine the relevant parts of the codebase to understand the existing architecture, patterns, and conventions
2. **Find Examples**: Look at similar implementations elsewhere in the codebase to understand how things are typically done
3. **Follow Conventions**: Match the existing code style, naming conventions, file structure, and patterns
4. **Implement Thoroughly**: Write complete, production-ready code with proper error handling
5. **Test Your Output**: After implementing, check your work for:
   - TypeScript compilation errors
   - Linting issues  
   - Logic errors
   - Missing imports or exports
   - Incomplete implementations
6. **Fix Issues**: If you find any problems in step 5, fix them before finishing
7. **Validate Integration**: Ensure your changes integrate properly with existing code

Make the necessary changes for the following task:`;

export const createCodingPrompt = (
  originalPrompt: string,
  customPrompt?: string
): string => {
  const basePrompt = customPrompt || DEFAULT_CODING_PROMPT;

  return `${basePrompt}
${originalPrompt}`;
};

export const createPRDescriptionPrompt = (
  taskDescription: string,
  recentPRs: Array<{ title: string; body: string; diff?: string }> = [],
  prDiff: string = ''
): string => {
  let examplesText = '';

  if (recentPRs.length > 0) {
    examplesText = `Here are examples of recent PR descriptions from this repository (ONLY the description content, use these as style guides):

`;
    recentPRs.forEach((pr, index) => {
      if (pr.body && pr.body.trim()) {
        examplesText += `Example ${index + 1} Description:
${pr.body}

`;
      }
    });

    if (
      examplesText ===
      `Here are examples of recent PR descriptions from this repository (ONLY the description content, use these as style guides):

`
    ) {
      examplesText = ''; // No examples found
    }
  }

  let diffText = '';
  if (prDiff) {
    diffText = `Current PR diff (for context):
${prDiff.substring(0, 2000)}${prDiff.length > 2000 ? '...' : ''}

`;
  }

  return `${examplesText}

Generate the pull request description for this task
${taskDescription}
${diffText}

Rules:
- Generate ONLY the description content, NOT the title or diff
- Keep each section short and factual
- Don't include a section if you don't have specific details about it
- No fluff or generic statements
- If you only know what was done but not why, only include Summary
- Learn from the style and format of the example descriptions above
- Use similar terminology and structure as the examples when appropriate
- Only include information from the current task description and diff text, not the provided examples

PR description:`;
};

export const createBranchNamePrompt = (
  taskDescription: string,
  maxBranchNameLength: number
): string => `Generate a short, descriptive Git branch name(kebab -case, max ${maxBranchNameLength} chars) for this task: "${taskDescription}".
  Rules:
- Use only lowercase letters, numbers, and hyphens
- Start with a letter
- Be descriptive but concise
- No special characters or spaces
- Maximum ${maxBranchNameLength} characters
- Examples: "fix-login-bug", "add-user-auth", "update-navbar-styles"

Branch name: `;

export const createPRTitlePrompt = (
  taskDescription: string,
  recentPRs: Array<{ title: string; body: string; diff?: string }> = [],
  prDiff: string = ''
): string => {
  let examplesText = '';

  if (recentPRs.length > 0) {
    examplesText = `Here are examples of recent PR titles from this repository (use these as style guides):

`;
    recentPRs.forEach((pr, index) => {
      examplesText += `Example ${index + 1}: ${pr.title}
`;
    });
  }

  let diffText = '';
  if (prDiff) {
    diffText = `Current PR diff:
${prDiff.substring(0, 1000)}${prDiff.length > 1000 ? '...' : ''}

`;
  }

  return `${examplesText}
Generate the pull request title for this task
${taskDescription}
${diffText}

Rules:
- Maximum 80 characters total
- Use imperative mood(e.g., "Add", "Fix", "Update")
- Be specific and descriptive
- Examples: "Fix authentication bug in login flow", "Add user profile settings page"
- Learn from the style and format of the example PR titles above
- Use similar terminology and structure as the examples when appropriate
- Only include information from the current task description and diff text, not the provided examples

PR title: `;
};

export const createTaskSummaryPrompt = (
  taskDescription: string
): string => `Generate a concise summary for this development task: "${taskDescription}".
Rules:
- Maximum 80 characters
- Capture the main action and purpose
- Use active voice and be specific
- Examples: "Fix user authentication bug in login flow", "Add responsive design to homepage"

Summary: `;

export const createCommitMessagePrompt = (
  taskDescription: string,
  changes: string[]
): string => {
  const changesText =
    changes.length > 0
      ? `\nFiles changed: ${changes.slice(0, 5).join(', ')} `
      : '';

  return `Generate a concise git commit message for this task: "${taskDescription}".${changesText}
Rules:
- Maximum 50 characters
- Use imperative mood(e.g., "Fix", "Add", "Update")
- No period at the end
- Be specific but concise
- Examples: "Fix login validation error", "Add user profile component"

Commit message: `;
};
