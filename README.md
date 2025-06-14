# Intern

Automated coding tool that wraps CLI coding assistants (OpenAI Codex, Claude Code, Amp Code) to automate the entire development workflow from task assignment to PR merge.

## Features

- 🤖 **AI-Powered Code Generation** - Integrates with Amp, OpenAI Codex, and Claude Code
- 🔄 **Complete Workflow Automation** - From task creation to PR merge
- 🌐 **Web Interface** - Modern, responsive UI for task management
- 📱 **Real-time Updates** - Live progress tracking via Server-Sent Events
- 🔧 **Precommit Checks** - Automated code quality enforcement
- 📊 **Task Management** - Comprehensive tracking and logging
- 🛠️ **CLI Interface** - Command-line tools for automation
- 🔐 **Secure Configuration** - Local SQLite storage for all settings

## Quick Start

### Prerequisites

- Node.js 18+ 
- Git repository (for task execution)
- At least one coding assistant CLI tool installed:
  - [Amp](https://www.amp.build/)
  - [OpenAI CLI](https://platform.openai.com/docs/guides/cli)
  - [Claude CLI](https://claude.ai/cli)

### Installation

```bash
# Clone or download the project
cd intern

# Install dependencies
npm install

# Build the project
npm run build

# Start Intern
npx intern start
```

### First-Time Setup

1. Visit http://localhost:3000
2. Complete the 3-step onboarding process:
   - **API Keys**: Configure your GitHub token and coding assistant API key
   - **GitHub Settings**: Set repository URL and username
   - **Preferences**: Customize branch prefixes, retry limits, etc.

### Creating Your First Task

#### Via Web Interface
1. Go to http://localhost:3000
2. Click "New Task"
3. Fill in title, description, and select coding tool
4. Click "Create Task"

#### Via CLI
```bash
npx intern task create
```

## Usage

### Web Interface

The web interface provides a complete task management experience:

- **Dashboard**: View all tasks with filtering and search
- **Task Details**: Monitor progress, view logs, and manage tasks
- **Settings**: Configure API keys, preferences, and precommit checks
- **Real-time Updates**: Live progress tracking as tasks execute

### CLI Commands

```bash
# Start the web server
intern start [--port 3000]

# Check system status
intern status

# Task management
intern task create          # Interactive task creation
intern task list           # List all tasks
intern task cancel <id>     # Cancel a specific task

# Configuration
intern config              # Check configuration status
```

### How It Works

1. **Task Creation**: Define what you want implemented
2. **Branch Creation**: Automatically creates a feature branch
3. **Code Generation**: Uses your chosen AI assistant to write code
4. **Precommit Checks**: Runs linting, tests, and type checking
5. **PR Creation**: Creates a pull request with generated code
6. **Review Loop**: Monitors PR comments and iterates based on feedback
7. **Completion**: Marks task complete when PR is merged

## Configuration

### Required Settings

- **GitHub Token**: Personal access token with `repo` permissions
  - Create at: https://github.com/settings/personal-access-tokens
- **Coding Assistant API Key**: Choose at least one:
  - Amp API Key
  - OpenAI API Key 
  - Claude API Key
- **Repository URL**: Full GitHub repository URL
- **GitHub Username**: Your GitHub username (for comment filtering)

### Optional Settings

- **Branch Prefix**: Prefix for generated branches (default: `intern/`)
- **PR Title Prefix**: Prefix for PR titles (default: `[INTERN]`)
- **Maximum Retries**: Retry limit for failed operations (default: 3)
- **Auto-merge**: Automatically merge PRs when checks pass (default: false)
- **Poll Interval**: How often to check for PR comments (default: 30 seconds)

### Precommit Checks

Configure custom precommit checks in the settings:

```bash
# Example checks
npm run type-check    # TypeScript type checking
npm run lint          # ESLint
npm test             # Unit tests
```

## Architecture

### System Components

- **Core Engine**: Main orchestration with retry logic
- **Express API**: RESTful backend with real-time events
- **SQLite Database**: Local storage for all data
- **Job Queue**: Custom SQLite-based background processing
- **Frontend**: Plain HTML/CSS/JS single-page application
- **CLI**: Command-line interface for automation

### Data Storage

All data is stored locally in `~/.intern/`:
```
~/.intern/
├── intern.db            # SQLite database
└── logs/                # Application logs
```

### Technology Stack

- **Backend**: TypeScript, Express.js, SQLite
- **Frontend**: Vanilla JavaScript, Tailwind CSS
- **CLI**: Commander.js
- **Git Operations**: simple-git
- **GitHub Integration**: Octokit
- **Process Management**: execa

## Development

### Setup

```bash
# Install dependencies
npm install

# Development mode (auto-reload)
npm run dev

# Build TypeScript
npm run build

# Type checking
npm run type-check

# Linting
npm run lint
```

### Project Structure

```
src/
├── api/              # Express.js API routes and server
├── cli/              # Command-line interface
├── core/             # Core business logic
├── types/            # TypeScript type definitions
└── utils/            # Utility functions

public/
├── js/               # Frontend JavaScript
├── css/              # Stylesheets
└── index.html        # Main HTML file
```

### Adding New Features

1. Update types in `src/types/index.ts`
2. Add database changes in `src/core/database.ts`
3. Implement core logic in appropriate manager
4. Add API routes in `src/api/routes.ts`
5. Update frontend in `public/js/`
6. Add CLI commands if needed

## Troubleshooting

### Common Issues

**Database Locked**
- Ensure only one Intern instance is running
- Check for zombie processes: `ps aux | grep intern`

**Git Errors**
- Verify working directory is a git repository
- Check git configuration and permissions

**API Failures**
- Verify API keys are correct and have proper permissions
- Check network connectivity and rate limits

**CLI Tool Missing**
- Install the required coding assistant CLI
- Ensure it's in your PATH and working: `amp --version`

### Getting Help

- Check the logs in `~/.intern/logs/`
- Use `intern status` to verify configuration
- View detailed task logs in the web interface
- Check the GitHub repository for issues and documentation

## Security

- API keys are stored locally in SQLite with restricted file permissions
- No secrets are transmitted over the network unnecessarily
- All external API calls use secure HTTPS connections
- Input validation on all user-provided data

## License

MIT License - see LICENSE file for details

## Contributing

Contributions welcome! Please read the development guide in AGENT.md and submit pull requests.
