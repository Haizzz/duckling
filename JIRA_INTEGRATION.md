# Jira Integration

The Duckling application now includes Jira integration for automatic ticket assignment.

## Setup

1. **Configure Jira Settings** in the web interface at `/settings`:
   - **API Key**: Your Jira API token (generate from your Jira account settings)
   - **JQL Query**: A JQL query to find tickets to implement

Both fields are required to use the Jira integration feature.

## Example JQL Queries

```jql
# Get tickets assigned to you that are ready for development
project = MYPROJECT AND status = "To Do" AND assignee = currentUser()

# Get highest priority tickets from your team
project = TEAM AND status = "Ready for Development" ORDER BY priority DESC

# Get specific epic tickets
"Epic Link" = EPIC-123 AND status = "To Do"
```

## Usage

```typescript
import { JiraManager } from './core/jira-manager';
import { SettingsManager } from './core/settings-manager';
import { DatabaseManager } from './core/database';

// Initialize
const db = new DatabaseManager();
const settings = new SettingsManager(db);
const jira = new JiraManager(settings);

// Get the latest ticket matching your JQL query
const ticket = await jira.getLatestTicket();

if (ticket) {
  console.log(`Found ticket: ${ticket.key} - ${ticket.summary}`);
  // Create a task from this ticket
  // ... integration with task creation
} else {
  console.log('No tickets found or Jira not configured');
}

// Test your Jira connection
const isConnected = await jira.testConnection();
console.log('Jira connection:', isConnected ? 'OK' : 'Failed');
```

## Ticket Object Structure

```typescript
interface JiraTicket {
  id: string;           // Internal Jira ID
  key: string;          // Ticket key (e.g., "PROJ-123")
  summary: string;      // Ticket title
  description: string;  // Ticket description
  status: string;       // Current status
  assignee?: string;    // Assigned person's display name
  created: string;      // Creation timestamp
  updated: string;      // Last update timestamp
}
```

## Security

- API keys are stored securely in the database
- API keys are never exposed in logs or API responses
- Uses HTTPS for all Jira API calls
- Early return if configuration is incomplete

## Error Handling

- Returns `null` if no configuration is provided
- Returns `null` if no tickets match the JQL query
- Logs appropriate error messages for debugging
- Uses retry mechanism for transient failures
