# Duckling Development Guide

## Overview
Duckling is an automated coding tool that wraps CLI coding assistants (OpenAI, Amp) to automate the entire development workflow from task assignment to PR merge.

## Quick Start

### Installation
```bash
pnpm install
pnpm run build
```

### Development
```bash
pnpm run dev        # Start in development mode
pnpm run build      # Build TypeScript
pnpm run type-check # Check TypeScript types
pnpm run lint       # Run ESLint
pnpm run check      # Run full check: type-check, lint, format, and test
```

### Running Duckling
```bash
# Start the web server
duckling start

# Check status
duckling status

# Create a task via CLI
duckling task create

# List tasks
duckling task list

# Cancel a task
duckling task cancel <taskId>
```

## Architecture

### Core Components
- **Manual Dependency Injection**: Constructor injection pattern where dependencies are passed as parameters
- **Core Engine**: Main orchestration logic with timeout-based processing and retry mechanisms  
- **Express API**: RESTful API with real-time updates via Server-Sent Events
- **Frontend**: Plain HTML/CSS/JS single-page application with real-time updates
- **CLI**: Command-line interface for basic operations
- **SQLite Database**: Local storage for tasks, logs, and settings

### Manual Dependency Injection
- **Constructor Injection**: Dependencies are passed as constructor parameters, not created internally
- **Direct Creation**: Dependencies are created directly in entry points (`src/index.ts`, `src/cli/index.ts`) and passed to services
- **No DI Container**: Uses manual dependency wiring without any formal dependency injection framework
- **Concrete Classes**: Uses concrete classes directly without interface abstractions
- **Dependency Flow**: Dependencies flow from entry points down through constructor parameters

### Key Files
- `src/core/engine.ts` - Main business logic with dependency injection
- `src/core/database.ts` - SQLite database manager
- `src/core/git-manager.ts` - Git operations with intelligent commit message generation
- `src/core/github-cli-provider.ts` - GitHub CLI integration with PR and comment management
- `src/core/openai-manager.ts` - OpenAI integration for commit messages and task summaries
- `src/core/coding-manager.ts` - Coding assistant integration (Amp, OpenAI)
- `src/core/precommit-manager.ts` - Precommit check execution and management
- `src/core/settings-manager.ts` - Application settings management
- `src/core/task-executor.ts` - Task execution queue to prevent overlapping operations
- `src/api/server.ts` - Express.js server
- `src/api/routes.ts` - API route handlers
- `public/js/app.js` - Frontend application controller with EventSource
- `public/js/dashboard.js` - Main dashboard with real-time task updates
- `public/js/task-detail.js` - Task detail page with live log streaming
- `src/cli/index.ts` - CLI interface

## Configuration

### Prerequisites
- **GitHub CLI**: Must be installed and authenticated before starting Duckling
- **Amp CLI**: Must be authenticated via `amp login` for Amp usage

### Optional Settings
- **OpenAI API Key**: For OpenAI coding assistance and commit message generation
- Branch prefix (default: `duckling-`)
- PR title prefix (default: `[DUCKLING]`)
- Commit suffix (default: ` [quack]`)
- Base branch (default: `main`)
- Maximum retries (default: 3)
- Auto-merge (default: false)
- Poll interval for PR comments (default: 30 seconds)

## Processing Architecture

### Task Processing Intervals
- **Pending Tasks**: Processed every 1 minute using setTimeout
- **Review Processing**: PR comments checked every 5 minutes using setTimeout
- **No Overlaps**: Uses flags to prevent concurrent processing of same type
- **Self-Rescheduling**: Each timeout reschedules itself after completion

### Real-time Updates
- **Server-Sent Events**: Real-time task updates via EventSource
- **Full Task Data**: Task updates include complete task object in metadata
- **Live UI Updates**: Dashboard and task detail pages update without refresh
- **Log Streaming**: Task logs update every 10 seconds for active tasks

## Testing

### Manual Testing Flow
1. Start Duckling: `duckling start`
2. Configure optional settings at http://localhost:5050/settings
3. Create a test task through the web interface
4. Monitor task progress in real-time
5. Check logs and task details
6. Verify GitHub integration (branch creation, PR creation)

### Key Test Scenarios
- **Task Creation**: Web and CLI task creation
- **Code Generation**: Integration with coding tools
- **Precommit Checks**: Running and handling failures
- **GitHub Integration**: Branch, PR, and comment handling
- **Error Recovery**: Retry mechanisms and failure handling
- **Real-time Updates**: SSE for live status updates

## Troubleshooting

### Common Issues
1. **Database locked**: Check if another Duckling instance is running
2. **Git errors**: Ensure working directory is a git repository
3. **API failures**: Verify API keys and network connectivity
4. **Permission errors**: Check GitHub CLI authentication
5. **Missing CLI tools**: Ensure coding assistant CLIs are installed (amp login)
6. **Wrong repository info**: GitHubCLIProvider now reinitializes per repository

### Debug Commands
```bash
# Check system status
duckling status

# View task logs
# Via web: http://localhost:5050/task/:id/logs

# Database location
ls ~/.duckling/
```

### Log Locations
- Application logs: `~/.duckling/logs/`
- Database: `~/.duckling/duckling.db`

## Development Patterns

### Adding New Features
1. Update types in `src/types/index.ts`
2. Add database schema changes in `src/core/database.ts`
3. Implement core logic in appropriate manager with constructor injection
4. Update entry points to create new services with dependencies
5. Add API routes in `src/api/routes.ts`
6. Update frontend in `public/js/`
7. Add CLI commands if needed

### Manual Dependency Injection Best Practices
- **Constructor Injection**: Dependencies are passed as constructor parameters
- **Direct Creation**: Create dependencies directly in entry points and pass them to services
- **Dependency Flow**: Dependencies flow from entry points down through constructor parameters

### Error Handling
- Use `withRetry` utility for external API calls
- Log errors to database with task association
- Emit task updates for real-time UI updates
- Provide meaningful error messages to users

### Testing with Dependency Injection
- **Mock Dependencies**: Create mock instances of dependencies for unit testing
- **Dependency Isolation**: Test services in isolation by passing mock dependencies
- **Integration Tests**: Test with real dependencies for integration scenarios

### Code Quality & Validation
- **ALWAYS run `pnpm run check` after making changes** to verify:
  - TypeScript compilation passes
  - Linting rules are followed
  - Code is properly formatted
  - All tests pass
- Fix any issues found before considering work complete
- The check command is comprehensive and catches most problems early

### Code Style
- Use TypeScript strict mode
- Follow existing naming conventions
- Add JSDoc comments for public APIs
- Use async/await for asynchronous operations
- Handle errors gracefully with user-friendly messages
- Use dependency injection for all service dependencies

## Recent Improvements

### Architecture Simplifications
- **Manual Dependency Injection**: Direct dependency creation in entry points (`src/index.ts`, `src/cli/index.ts`) with manual wiring
- **Factory Methods**: Git and GitHub managers created on-demand via factory methods within CoreEngine
- **No Required Settings**: All configuration is now optional with helpful warnings
- **Clean Authentication**: Amp assumes CLI authentication, OpenAI is optional

### Bug Fixes
- **Repository Switching**: GitHubCLIProvider now properly reinitializes for different repositories
- **Optional Configuration**: OpenAI API key shows warnings instead of blocking errors
- **Removed Unused Code**: Cleaned up repositoryUrl and unused hasAmpTool variables

### Current State
- **Zero Required Configuration**: Application works out of the box
- **GitHub CLI**: Only hard requirement for repository operations
- **Amp Integration**: Uses existing CLI authentication
- **OpenAI Integration**: Optional for enhanced commit messages and coding assistance

## Security Considerations
- OpenAI API keys stored in SQLite database with file permissions
- Amp authentication handled via CLI (no keys stored)
- No secrets in logs or error messages
- Input validation on all API endpoints
- Sandboxed execution of coding tools
- HTTPS recommended for production use
