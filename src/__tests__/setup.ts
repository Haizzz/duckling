// Jest setup file

// Mock fs for tests that don't need actual file system
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
}));

// Mock better-sqlite3 for database tests
jest.mock('better-sqlite3', () => {
  return jest.fn().mockImplementation(() => ({
    pragma: jest.fn(),
    exec: jest.fn(),
    prepare: jest.fn().mockReturnValue({
      run: jest.fn(),
      get: jest.fn(),
      all: jest.fn(),
    }),
    close: jest.fn(),
  }));
});

// Mock execa for exec tests
jest.mock('execa', () => ({
  execa: jest.fn(),
}));

// Mock simple-git
jest.mock('simple-git', () => ({
  simpleGit: jest.fn().mockReturnValue({
    init: jest.fn(),
    add: jest.fn(),
    commit: jest.fn(),
    push: jest.fn(),
    checkout: jest.fn(),
    checkoutBranch: jest.fn(),
    status: jest.fn(),
    branch: jest.fn(),
    raw: jest.fn(),
  }),
}));

// Mock openai
jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  })),
}));

// Set up global test environment
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
};
