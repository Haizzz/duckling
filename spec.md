# Intern - Automated Coding Tool System Specification

## Overview
Intern is an automated development workflow orchestration system that integrates CLI coding assistants (OpenAI Codex, Claude Code, Amp Code) to handle the complete development lifecycle from task assignment to PR merge. The system emphasizes resilience, retry mechanisms, and real-time monitoring.

## System Architecture

### High-Level Architecture

```mermaid
graph TB
    UI[Web Interface] --> API[Express API Server]
    CLI[CLI Interface] --> API
    API --> Core[Core Engine]
    
    Core --> TE[Task Executor]
    Core --> GM[Git Manager] 
    Core --> CM[Coding Manager]
    Core --> PRM[PR Manager]
    Core --> PM[Precommit Manager]
    Core --> OAI[OpenAI Manager]
    
    TE --> DB[(SQLite Database)]
    Core --> DB
    
    CM --> Agents[External Coding Agents]
    Agents --> AmpCLI[Amp CLI]
    Agents --> OpenAICLI[OpenAI CLI]
    
    GM --> Git[Git Operations]
    GM --> OAI
    PRM --> GitHub[GitHub API]
    PM --> Hooks[Precommit Hooks]
    
    API --> SSE[Server-Sent Events]
    SSE --> UI
```

### Component Responsibilities

| Component | Primary Responsibilities |
|-----------|-------------------------|
| **Core Engine** | Task orchestration, timeout-based processing, error recovery |
| **Task Executor** | Queue management, overlap prevention, execution coordination |
| **Git Manager** | Branch operations, commit creation, push/pull operations |
| **Coding Manager** | Integration with external coding tools, prompt management |
| **PR Manager** | GitHub PR lifecycle, comment monitoring, merge operations |
| **Precommit Manager** | Code quality validation, check execution, failure handling |
| **OpenAI Manager** | AI-powered commit messages, task summaries, content generation |
| **Database Manager** | Data persistence, schema management, query operations |

## Processing Architecture

### Timeout-Based Processing Model

The system uses separate timeout intervals for different processing types to prevent overlap and ensure reliable execution:

```mermaid
sequenceDiagram
    participant Engine as Core Engine
    participant TaskTimer as Task Processing Timer
    participant ReviewTimer as Review Processing Timer
    participant DB as Database

    Engine->>TaskTimer: Schedule task processing (60s intervals)
    Engine->>ReviewTimer: Schedule review processing (300s intervals)
    
    loop Every 60 seconds
        TaskTimer->>Engine: Process pending tasks
        Engine->>DB: Query pending tasks
        Engine->>Engine: Execute task workflow
        TaskTimer->>TaskTimer: Reschedule next cycle
    end
    
    loop Every 300 seconds
        ReviewTimer->>Engine: Process reviews
        Engine->>DB: Query awaiting-review tasks
        Engine->>Engine: Check PR comments/status
        ReviewTimer->>ReviewTimer: Reschedule next cycle
    end
```

### Task State Machine

```mermaid
stateDiagram-v2
    [*] --> Pending: Task created
    Pending --> InProgress: Engine picks up task
    InProgress --> AwaitingReview: PR created successfully
    InProgress --> Failed: Unrecoverable error
    InProgress --> Cancelled: User cancellation
    AwaitingReview --> InProgress: Review feedback received
    AwaitingReview --> Completed: PR merged
    AwaitingReview --> Cancelled: User cancellation
    Failed --> [*]: Terminal state
    Completed --> [*]: Terminal state
    Cancelled --> [*]: Terminal state
```

## Workflow Specifications

### Task Execution Workflow

```mermaid
flowchart TD
    Start([Task Created]) --> Validate{Validate Input}
    Validate -->|Invalid| Fail([Mark Failed])
    Validate -->|Valid| Branch[Create Git Branch]
    
    Branch --> BranchCheck{Branch Exists?}
    BranchCheck -->|Yes| Increment[Generate Incremented Name]
    Increment --> Branch
    BranchCheck -->|No| Coding[Execute Coding Tool]
    
    Coding --> CodingCheck{Coding Success?}
    CodingCheck -->|No| Retry1{Retry Available?}
    Retry1 -->|Yes| Wait1[Exponential Backoff]
    Wait1 --> Coding
    Retry1 -->|No| Fail
    
    CodingCheck -->|Yes| Precommit[Run Precommit Checks]
    Precommit --> PrecommitCheck{Checks Pass?}
    PrecommitCheck -->|No| Fix[Request Fixes]
    Fix --> FixCheck{Fix Success?}
    FixCheck -->|No| Retry2{Retry Available?}
    Retry2 -->|Yes| Wait2[Exponential Backoff]
    Wait2 --> Fix
    Retry2 -->|No| Fail
    FixCheck -->|Yes| Precommit
    
    PrecommitCheck -->|Yes| Commit[Create Commit]
    Commit --> Push[Push to Remote]
    Push --> PR[Create Pull Request]
    
    PR --> PRCheck{PR Created?}
    PRCheck -->|No| Retry3{Retry Available?}
    Retry3 -->|Yes| Wait3[Exponential Backoff]
    Wait3 --> PR
    Retry3 -->|No| Fail
    
    PRCheck -->|Yes| Monitor([Monitor for Reviews])
```

### Review Processing Workflow

```mermaid
flowchart TD
    Timer([Review Timer Triggered]) --> Query[Query Awaiting Review Tasks]
    Query --> Batch[Batch Process All Tasks]
    
    Batch --> CheckPR[Check PR Status & Comments]
    CheckPR --> Merged{PR Merged?}
    Merged -->|Yes| Complete[Mark Completed]
    
    Merged -->|No| Closed{PR Closed?}
    Closed -->|Yes| Cancel[Mark Cancelled]
    
    Closed -->|No| NewComments{New Comments?}
    NewComments -->|No| Continue[Continue Monitoring]
    
    NewComments -->|Yes| Filter[Filter User Comments]
    Filter --> Process[Process Feedback]
    Process --> Generate[Generate Code Changes]
    Generate --> Validate[Run Precommit Checks]
    Validate --> Update[Update PR]
    
    Complete --> End([End])
    Cancel --> End
    Continue --> End
    Update --> End
```

## Data Architecture

### Database Schema Specification

#### Tasks Table
```sql
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  summary TEXT,                    -- AI-generated task summary
  status TEXT NOT NULL,            -- pending, in-progress, awaiting-review, completed, failed, cancelled
  coding_tool TEXT NOT NULL,       -- openai, amp, claude
  current_stage TEXT,              -- current processing stage for UI display
  branch_name TEXT,                -- git branch name
  pr_number INTEGER,               -- GitHub PR number
  pr_url TEXT,                     -- GitHub PR URL
  retry_count INTEGER DEFAULT 0,   -- current retry attempt
  max_retries INTEGER DEFAULT 3,   -- maximum retry attempts
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);
```

#### Task Logs Table
```sql
CREATE TABLE task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  level TEXT NOT NULL,             -- info, error, debug, warning
  component TEXT,                  -- git-manager, coding-manager, etc.
  message TEXT NOT NULL,
  details TEXT,                    -- additional structured data
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

#### Settings Table
```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  category TEXT NOT NULL,          -- api_keys, general, precommit, github
  data_type TEXT DEFAULT 'string', -- string, number, boolean, json
  is_secret BOOLEAN DEFAULT 0,     -- for secure handling
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### Precommit Checks Table
```sql
CREATE TABLE precommit_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  required BOOLEAN DEFAULT 1,      -- failure blocks task completion
  enabled BOOLEAN DEFAULT 1,       -- check is active
  timeout_seconds INTEGER DEFAULT 300,
  order_index INTEGER DEFAULT 0,   -- execution order
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### System Configuration Table
```sql
CREATE TABLE system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  metadata TEXT,                   -- JSON metadata
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Data Flow Specifications

#### Configuration Data Flow
```mermaid
graph LR
    UI[Settings UI] --> API[Settings API]
    CLI[CLI Config] --> API
    API --> Validator[Schema Validator]
    Validator --> DB[(SQLite Settings)]
    DB --> Cache[Memory Cache]
    Cache --> Components[System Components]
```

#### Task Data Flow
```mermaid
graph TD
    Create[Task Creation] --> DB[(Database)]
    DB --> Queue[Processing Queue]
    Queue --> Engine[Core Engine]
    Engine --> Updates[Status Updates]
    Updates --> SSE[Server-Sent Events]
    SSE --> UI[Web Interface]
    Updates --> DB
```

## API Specifications

### REST API Endpoints

#### Task Management
| Endpoint | Method | Purpose | Request Body | Response |
|----------|--------|---------|--------------|-----------|
| `/api/tasks` | GET | List tasks with filtering/pagination | Query params | TaskList |
| `/api/tasks` | POST | Create new task | TaskCreationRequest | Task |
| `/api/tasks/:id` | GET | Get task details | None | Task |
| `/api/tasks/:id/cancel` | POST | Cancel running task | None | StatusResponse |
| `/api/tasks/:id/retry` | POST | Retry failed task | None | StatusResponse |
| `/api/tasks/:id/logs` | GET | Get task execution logs | Query params | LogList |

#### Settings Management
| Endpoint | Method | Purpose | Request Body | Response |
|----------|--------|---------|--------------|-----------|
| `/api/settings` | GET | Get all settings | None | SettingsMap |
| `/api/settings` | PUT | Update multiple settings | SettingsUpdateRequest | StatusResponse |
| `/api/settings/:category` | GET | Get settings by category | None | SettingsMap |
| `/api/settings/onboarding` | GET | Check onboarding status | None | OnboardingStatus |
| `/api/settings/onboarding` | POST | Complete onboarding | OnboardingData | StatusResponse |

#### System Management
| Endpoint | Method | Purpose | Request Body | Response |
|----------|--------|---------|--------------|-----------|
| `/api/health` | GET | System health check | None | HealthStatus |
| `/api/events` | GET | Server-Sent Events stream | None | EventStream |

### Data Transfer Objects

#### Task Creation Request
```typescript
interface TaskCreationRequest {
  title: string;
  description: string;
  codingTool: 'openai' | 'amp' | 'claude';
  branchPrefix?: string;
  prPrefix?: string;
  autoMerge?: boolean;
}
```

#### Task Response
```typescript
interface Task {
  id: number;
  title: string;
  description: string;
  summary?: string;
  status: TaskStatus;
  codingTool: string;
  currentStage?: string;
  branchName?: string;
  prNumber?: number;
  prUrl?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  progress?: TaskProgress;
}
```

#### Server-Sent Event Format
```typescript
interface TaskUpdateEvent {
  type: 'task-update' | 'log-entry' | 'system-status';
  taskId?: number;
  data: {
    status?: TaskStatus;
    progress?: TaskProgress;
    metadata?: any;
    logEntry?: LogEntry;
  };
}
```

## Integration Specifications

### External Coding Tools Integration

#### Tool Interface Contract
```typescript
interface CodingToolAdapter {
  name: string;
  isAvailable(): Promise<boolean>;
  generateCode(prompt: string, context: CodeContext): Promise<CodeResponse>;
  fixIssues(issues: Issue[], context: CodeContext): Promise<CodeResponse>;
}
```

#### Code Context Structure
```typescript
interface CodeContext {
  taskDescription: string;
  existingFiles: FileInfo[];
  changedFiles: FileInfo[];
  errorMessages?: string[];
  previousAttempts?: number;
}
```

### GitHub Integration Specifications

#### PR Management Interface
```typescript
interface PRManager {
  createPR(branch: string, title: string, description: string): Promise<PR>;
  updatePR(prNumber: number, updates: PRUpdate): Promise<PR>;
  getComments(prNumber: number, since?: Date): Promise<Comment[]>;
  mergePR(prNumber: number, options: MergeOptions): Promise<MergeResult>;
}
```

#### Comment Processing Rules
- Only process comments from configured GitHub username
- Ignore bot comments and automated messages
- Parse natural language feedback into actionable tasks
- Track comment processing to avoid duplicates

### Git Operations Specifications

#### Branch Management Strategy
- **Naming Convention**: `{prefix}{task-slug}-{increment}`
- **Conflict Resolution**: Auto-increment suffix for duplicate names
- **Cleanup Policy**: Preserve branches until task completion/cancellation

#### Commit Strategy
- **Message Generation**: AI-powered via OpenAI integration
- **Suffix Application**: Configurable suffix for identification
- **Atomic Commits**: One commit per task iteration
- **Deduplication**: Prevent duplicate suffixes in messages

## Error Handling & Resilience

### Retry Strategy Specifications

#### Exponential Backoff Configuration
```typescript
interface RetryConfig {
  maxAttempts: number;        // Default: 3
  baseDelay: number;          // Default: 1000ms
  maxDelay: number;           // Default: 30000ms
  jitterFactor: number;       // Default: 0.1
  exponentialBase: number;    // Default: 2
}
```

#### Retry Trigger Conditions
| Scenario | Detection Method | Retry Strategy |
|----------|------------------|----------------|
| API Rate Limiting | HTTP 429 response | Respect Retry-After header |
| Network Timeouts | Request timeout | Standard exponential backoff |
| Git Conflicts | Git command failure | Branch name increment |
| Tool Unavailable | Command not found | Fail fast, no retry |
| Precommit Failures | Non-zero exit code | Request fixes, retry checks |

### Error Recovery Workflows

#### Startup Recovery Process
```mermaid
flowchart TD
    Start([System Startup]) --> Query[Query Incomplete Tasks]
    Query --> Check{Tasks Found?}
    Check -->|No| Ready[System Ready]
    Check -->|Yes| Validate[Validate Task State]
    
    Validate --> BranchExists{Branch Exists?}
    BranchExists -->|No| MarkFailed[Mark Task Failed]
    BranchExists -->|Yes| PRExists{PR Exists?}
    
    PRExists -->|No| Resume[Resume from Coding]
    PRExists -->|Yes| Monitor[Resume Monitoring]
    
    MarkFailed --> Next{More Tasks?}
    Resume --> Next
    Monitor --> Next
    Next -->|Yes| Validate
    Next -->|No| Ready
```

#### Failure Classification
| Category | Examples | Recovery Action |
|----------|----------|-----------------|
| **Transient** | Network errors, API timeouts | Automatic retry with backoff |
| **Configuration** | Invalid API keys, missing tools | Fail fast, notify user |
| **Code Quality** | Linting failures, type errors | Request AI fixes, retry |
| **External** | GitHub API errors | Retry with backoff |
| **Fatal** | Corrupted repository, disk full | Fail task, alert user |

## Security Considerations

### Data Protection
- **API Keys**: Encrypted storage with file system permissions
- **Secrets Handling**: Never log or expose in error messages
- **Input Validation**: Sanitize all user inputs and external responses
- **Process Isolation**: Sandbox external tool execution

### GitHub Security
- **Token Scope**: Minimum required permissions (repo access)
- **Webhook Verification**: HMAC signature validation
- **Rate Limiting**: Respect GitHub API limits
- **Access Control**: User-based comment filtering

## Performance Specifications

### Resource Requirements
- **Memory**: 256MB base + 50MB per active task
- **CPU**: Minimal during idle, burst during processing
- **Disk**: 100MB for application + log storage
- **Network**: GitHub API + coding tool API bandwidth

### Scalability Limits
- **Concurrent Tasks**: 10 tasks (configurable)
- **Database Size**: SQLite practical limit (~100GB)
- **Log Retention**: 30 days default, configurable
- **API Rate Limits**: GitHub (5000/hour), OpenAI (configurable)

### Performance Monitoring
```typescript
interface PerformanceMetrics {
  taskCompletionTime: number;      // Average task duration
  apiResponseTime: number;         // External API latency
  retryRate: number;              // Percentage of tasks requiring retries
  errorRate: number;              // Percentage of failed tasks
  queueDepth: number;             // Number of pending tasks
}
```

## Configuration Specifications

### Settings Categories

#### API Keys Category
```typescript
interface APIKeysSettings {
  githubToken: string;              // Required
  openaiApiKey?: string;           // Optional
  claudeApiKey?: string;           // Optional
  ampApiKey?: string;              // Optional
}
```

#### General Settings Category
```typescript
interface GeneralSettings {
  defaultCodingTool: 'openai' | 'amp' | 'claude';
  branchPrefix: string;            // Default: 'intern/'
  prPrefix: string;                // Default: '[INTERN]'
  commitSuffix: string;            // Default: ' [i]'
  baseBranch: string;              // Default: 'main'
  autoMerge: boolean;              // Default: false
  maxRetries: number;              // Default: 3
  pollInterval: number;            // Default: 30 seconds
}
```

#### GitHub Settings Category
```typescript
interface GitHubSettings {
  githubRepoUrl: string;           // Required
  githubUsername: string;          // Required for comment filtering
  webhookSecret?: string;          // Optional for webhook verification
}
```

### Configuration Validation Rules
- **GitHub Token**: Validate permissions and repository access
- **API Keys**: Test connectivity and authentication
- **Repository URL**: Validate format and accessibility
- **Numeric Settings**: Range validation and type checking
- **Required Fields**: Enforce completion before system operation

## Development Considerations

### Technology Stack Rationale
| Technology | Justification |
|------------|---------------|
| **TypeScript** | Type safety, developer experience, tooling ecosystem |
| **Express.js** | Lightweight, mature, extensive middleware support |
| **SQLite** | Zero configuration, ACID compliance, local storage |
| **Server-Sent Events** | Real-time updates, simpler than WebSockets |
| **Tailwind CSS** | Rapid prototyping, consistent design system |

### Deployment Architecture
```mermaid
graph TB
    User[User] --> Web[Web Browser]
    Web --> Server[Express Server]
    Server --> SQLite[(SQLite DB)]
    Server --> GitHub[GitHub API]
    Server --> Tools[External Coding Tools]
    
    subgraph "Local Environment"
        Server
        SQLite
        Tools
    end
    
    subgraph "External Services"
        GitHub
    end
```

### Extensibility Points
- **Coding Tool Adapters**: Plugin system for new AI services
- **Precommit Checks**: Configurable validation pipeline
- **Notification Channels**: Email, Slack, Discord integrations
- **Git Providers**: GitLab, Bitbucket support
- **Authentication**: OAuth, SSO integration

This specification provides a comprehensive blueprint for implementing the Intern system while maintaining flexibility for future enhancements and ensuring robust, reliable operation in production environments.
