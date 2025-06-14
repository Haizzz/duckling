# Intern Development Guide

## Overview
Intern is an automated coding tool that wraps CLI coding assistants (OpenAI Codex, Claude Code, Amp Code) to automate the entire development workflow from task assignment to PR merge.

## Quick Start

### Installation
```bash
npm install
npm run build
```

### Development
```bash
npm run dev        # Start in development mode
npm run build      # Build TypeScript
npm run type-check # Check TypeScript types
npm run lint       # Run ESLint
```

### Running Intern
```bash
# Start the web server
intern start

# Check status
intern status

# Create a task via CLI
intern task create

# List tasks
intern task list

# Cancel a task
intern task cancel <taskId>
```

## Architecture

### Core Components
- **Core Engine**: Main orchestration logic with retry mechanisms
- **Express API**: RESTful API with real-time updates via Server-Sent Events
- **Frontend**: Plain HTML/CSS/JS single-page application
- **CLI**: Command-line interface for basic operations
- **SQLite Database**: Local storage for tasks, logs, settings, and job queue

### Key Files
- `src/core/engine.ts` - Main business logic
- `src/core/database.ts` - SQLite database manager
- `src/core/job-queue.ts` - Custom SQLite-based job queue
- `src/api/server.ts` - Express.js server
- `src/api/routes.ts` - API route handlers
- `public/js/app.js` - Frontend application controller
- `src/cli/index.ts` - CLI interface

## Configuration

### Required Settings
- **GitHub Token**: Personal access token with repo permissions
- **Coding Tool API Key**: At least one of Amp, OpenAI, or Claude
- **Repository URL**: GitHub repository to work with
- **GitHub Username**: For PR comment filtering

### Optional Settings
- Branch prefix (default: `intern/`)
- PR title prefix (default: `[INTERN]`)
- Maximum retries (default: 3)
- Auto-merge (default: false)
- Poll interval for PR comments (default: 30 seconds)

## Testing

### Manual Testing Flow
1. Start Intern: `intern start`
2. Complete onboarding at http://localhost:3000
3. Create a test task through the web interface
4. Monitor task progress in real-time
5. Check logs and task details
6. Verify GitHub integration (branch creation, PR creation)

### Key Test Scenarios
- **Onboarding**: First-time setup flow
- **Task Creation**: Web and CLI task creation
- **Code Generation**: Integration with coding tools
- **Precommit Checks**: Running and handling failures
- **GitHub Integration**: Branch, PR, and comment handling
- **Error Recovery**: Retry mechanisms and failure handling
- **Real-time Updates**: SSE for live status updates

## Troubleshooting

### Common Issues
1. **Database locked**: Check if another Intern instance is running
2. **Git errors**: Ensure working directory is a git repository
3. **API failures**: Verify API keys and network connectivity
4. **Permission errors**: Check GitHub token permissions
5. **Missing CLI tools**: Ensure coding assistant CLIs are installed

### Debug Commands
```bash
# Check system status
intern status

# View task logs
# Via web: http://localhost:3000/task/:id/logs

# Database location
ls ~/.intern/
```

### Log Locations
- Application logs: `~/.intern/logs/`
- Database: `~/.intern/intern.db`

## Development Patterns

### Adding New Features
1. Update types in `src/types/index.ts`
2. Add database schema changes in `src/core/database.ts`
3. Implement core logic in appropriate manager
4. Add API routes in `src/api/routes.ts`
5. Update frontend in `public/js/`
6. Add CLI commands if needed

### Error Handling
- Use `withRetry` utility for external API calls
- Log errors to database with task association
- Emit task updates for real-time UI updates
- Provide meaningful error messages to users

### Code Style
- Use TypeScript strict mode
- Follow existing naming conventions
- Add JSDoc comments for public APIs
- Use async/await for asynchronous operations
- Handle errors gracefully with user-friendly messages

## Security Considerations
- API keys stored in SQLite database with file permissions
- No secrets in logs or error messages
- Input validation on all API endpoints
- Sandboxed execution of coding tools
- HTTPS recommended for production use
