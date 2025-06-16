# Duckling

<p align="center">
  <img src="public/assets/logo.png" alt="Duckling Logo" width="120" height="120">
</p>

**Duckling** is an automated asynchronous coding assistant that wraps CLI coding tools (OpenAI Codex and Amp Code) to automate code development workflow from task assignment to PR merge.

- Automate the PR life cycle from task assignment to PR merge
- Autonomously and asynchronously work on tasks
- Continuously monitor PR comments and implement requested changes
- Control workflow outside of code generation to restrict blast radius

https://github.com/user-attachments/assets/9ffb6b6f-62be-4500-a099-cde1c9521835

## Why?

All I've ever wanted is Codex web interface, however:
- Large repositories are too complex for online coding tools like Codex web interface to setup
- Local repositories already have optimized tooling, build systems, and dependencies configured
- Existing tools require active hand holding one task at a time

## Setup

### Prerequisites

- Node.js 20+
- Git repository
- One of the following CLI tools:
  - [Amp](https://www.amp.build/)
  - [OpenAI CLI](https://platform.openai.com/docs/guides/cli)

### Installation

```bash
# Run directly from GitHub
npx github:haizzz/duckling start
```

### Configuration

1. **API Keys Required:**
   - **GitHub Token**: https://github.com/settings/personal-access-tokens (requires repo permissions)
   - **Amp Token**: Available from Amp dashboard
   - **OpenAI API Key**: https://platform.openai.com/api-keys

2. **Setup:**
   - Access web interface at http://localhost:5050
   - Navigate to Settings
   - Add API keys and GitHub username
   - Select coding tool preference
   - Set base branch

## Usage

### Task Creation

**Web Interface:**
1. Go to http://localhost:5050
2. Enter task description in the text area
3. Press the arrow button or Enter to submit

**CLI:**
```bash
npx duckling task create
```

### Command Reference

```bash
duckling start [--port 5050]    # Start web server
duckling status                 # Check configuration
duckling task list             # List all tasks  
duckling task cancel <id>      # Cancel task
duckling config               # View configuration status
```

## Workflow Process

1. **Task Input** - Natural language task description
2. **Branch Creation** - Creates feature branch with `duckling-` prefix
3. **Code Generation** - Executes chosen AI assistant with task context
4. **Precommit Execution** - Runs configured checks (lint, test, typecheck)
5. **PR Creation** - Opens GitHub pull request with generated changes
6. **Review Monitoring** - Polls PR comments for feedback
7. **Iteration** - Implements requested changes automatically
8. **Completion** - Marks task done when PR is merged

## Data Storage

Local SQLite database at `~/.duckling/`:
```
~/.duckling/
├── duckling.db          # Tasks, settings, logs
└── logs/                # Application logs
```

## FAQ

**Q: Where are API keys stored?**
A: Locally in SQLite database at `~/.duckling/duckling.db` with restricted file permissions.

**Q: Why separate PR review handling from the coding tool?**
A: PR monitoring requires continuous GitHub API polling, git operations, and coordination of multiple tools (precommit checks, branch management). The tools themselves can technically run shell commands to do this but risks an edge case deleting all your PRs or adding gibberish commits. The structured workflow limits it to just coding.

**Q: Where are logs located?**
A: Application logs in `~/.duckling/logs/`, task logs in the SQLite database viewable via web interface.
