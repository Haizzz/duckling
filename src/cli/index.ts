#!/usr/bin/env node

import { Command } from 'commander';
import { CodingTool, CreateTaskRequest } from '../types';
import { startDuckling } from '../index';
import { DatabaseManager } from '../core/database';
import { SettingsManager } from '../core/settings-manager';
import { CodingManager } from '../core/coding-manager';
import { PrecommitManager } from '../core/precommit-manager';
import { OpenAIManager } from '../core/openai-manager';
import { JiraManager } from '../core/jira-manager';
import { CoreEngine } from '../core/engine';
import * as readline from 'readline';

const program = new Command();

// Helper function to create services
function createServices() {
  const db = new DatabaseManager();
  const settings = new SettingsManager(db);

  // Initialize Jira API key from environment variable if available
  if (process.env.JIRA_API_KEY && !settings.get('jiraApiKey')) {
    settings.set('jiraApiKey', process.env.JIRA_API_KEY);
  }

  const codingManager = new CodingManager(settings);
  const precommitManager = new PrecommitManager(db);
  const openaiManager = new OpenAIManager(db, settings);
  const jiraManager = new JiraManager(settings, db);
  const engine = new CoreEngine(
    db,
    settings,
    codingManager,
    precommitManager,
    openaiManager,
    jiraManager
  );

  return {
    db,
    settings,
    codingManager,
    precommitManager,
    openaiManager,
    engine,
  };
}

program
  .name('duckling')
  .description('Automated coding tool that wraps CLI coding assistants')
  .version('1.0.0');

// Start command - launch the web server
program
  .command('start')
  .description('Start the Duckling web server')
  .option('-p, --port <port>', 'Port to run the server on', '5050')
  .action(async (options) => {
    try {
      const port = parseInt(options.port);
      await startDuckling(port);
    } catch (error: any) {
      console.error('❌ Failed to start Duckling:', error.message);
      process.exit(1);
    }
  });

// Config command - initial setup
program
  .command('config')
  .description('Configure Duckling settings')
  .action(async () => {
    try {
      const services = createServices();

      console.log(
        '💡 Use the web interface at http://localhost:5050/settings to configure Duckling'
      );
      services.db.close();
    } catch (error: any) {
      console.error('❌ Failed to check configuration:', error.message);
      process.exit(1);
    }
  });

// Task command group
const taskCmd = program.command('task').description('Manage tasks');

// Create task command
taskCmd
  .command('create')
  .description('Create a new task interactively')
  .action(async () => {
    try {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const question = (prompt: string): Promise<string> => {
        return new Promise((resolve) => {
          rl.question(prompt, resolve);
        });
      };

      console.log('📝 Creating a new task...\n');

      const title = await question('Task title: ');
      if (!title.trim()) {
        console.log('❌ Task title is required');
        rl.close();
        return;
      }

      const description = await question('Task description: ');
      if (!description.trim()) {
        console.log('❌ Task description is required');
        rl.close();
        return;
      }

      const codingTool =
        (await question('Coding tool (amp/openai/claude) [amp]: ')) || 'amp';
      if (!['amp', 'openai', 'claude'].includes(codingTool)) {
        console.log('❌ Invalid coding tool. Use: amp, openai, or claude');
        rl.close();
        return;
      }

      rl.close();

      const services = createServices();
      await services.engine.initialize();

      const taskRequest: CreateTaskRequest = {
        title: title.trim(),
        description: description.trim(),
        codingTool: codingTool as CodingTool,
        repositoryPath: process.cwd(), // Use current directory for CLI
      };

      const taskId = await services.engine.createTask(taskRequest);

      console.log(`\n✅ Task created successfully!`);
      console.log(`📋 Task ID: ${taskId}`);
      console.log(`🔗 View task: http://localhost:5050/task/${taskId}`);

      services.engine.shutdown();
      services.db.close();
    } catch (error: any) {
      console.error('❌ Failed to create task:', error.message);
      process.exit(1);
    }
  });

// List tasks command
taskCmd
  .command('list')
  .description('List all tasks')
  .option(
    '-s, --status <status>',
    'Filter by status (pending/in-progress/awaiting-review/completed/failed/cancelled)'
  )
  .option('-l, --limit <limit>', 'Limit number of results', '10')
  .action(async (options) => {
    try {
      const services = createServices();

      const filters: any = {
        limit: parseInt(options.limit),
      };

      if (options.status) {
        filters.status = options.status;
      }

      const tasks = services.db.getTasks(filters);

      if (tasks.length === 0) {
        console.log('📭 No tasks found');
        services.db.close();
        return;
      }

      console.log(`📋 Found ${tasks.length} task(s):\n`);

      tasks.forEach((task: any) => {
        const statusEmojis: Record<string, string> = {
          pending: '⏳',
          'in-progress': '🔄',
          'awaiting-review': '👀',
          completed: '✅',
          failed: '❌',
          cancelled: '🚫',
        };
        const statusEmoji = statusEmojis[task.status] || '❓';

        console.log(`${statusEmoji} ${task.title}`);
        console.log(`   ID: ${task.id}`);
        console.log(`   Status: ${task.status}`);
        console.log(`   Tool: ${task.coding_tool}`);
        console.log(
          `   Created: ${new Date(task.created_at).toLocaleString()}`
        );
        if (task.pr_url) {
          console.log(`   PR: ${task.pr_url}`);
        }
        console.log('');
      });

      services.db.close();
    } catch (error: any) {
      console.error('❌ Failed to list tasks:', error.message);
      process.exit(1);
    }
  });

// Cancel task command
taskCmd
  .command('cancel <taskId>')
  .description('Cancel a task')
  .action(async (taskId) => {
    try {
      const services = createServices();
      await services.engine.initialize();

      const task = services.db.getTask(parseInt(taskId));
      if (!task) {
        console.log(`❌ Task not found: ${taskId}`);
        services.engine.shutdown();
        services.db.close();
        return;
      }

      if (task.status === 'completed' || task.status === 'cancelled') {
        console.log(`❌ Cannot cancel task in status: ${task.status}`);
        services.engine.shutdown();
        services.db.close();
        return;
      }

      await services.engine.cancelTask(parseInt(taskId));

      console.log(`✅ Task cancelled: ${task.title}`);

      services.engine.shutdown();
      services.db.close();
    } catch (error: any) {
      console.error('❌ Failed to cancel task:', error.message);
      process.exit(1);
    }
  });

// Retry task command
taskCmd
  .command('retry <taskId>')
  .description('Retry a failed or cancelled task')
  .action(async (taskId) => {
    try {
      const services = createServices();
      await services.engine.initialize();

      const task = services.db.getTask(parseInt(taskId));
      if (!task) {
        console.log(`❌ Task not found: ${taskId}`);
        services.engine.shutdown();
        services.db.close();
        return;
      }

      if (task.status !== 'failed' && task.status !== 'cancelled') {
        console.log(
          `❌ Cannot retry task in status: ${task.status}. Only failed or cancelled tasks can be retried.`
        );
        services.engine.shutdown();
        services.db.close();
        return;
      }

      await services.engine.retryTask(parseInt(taskId));

      console.log(`✅ Task retry initiated: ${task.title}`);
      console.log(
        `🔗 View task: http://localhost:5050/task-detail.html?id=${taskId}`
      );

      services.engine.shutdown();
      services.db.close();
    } catch (error: any) {
      console.error('❌ Failed to retry task:', error.message);
      process.exit(1);
    }
  });

// Status command - show system status
program
  .command('status')
  .description('Show system status and configuration')
  .action(async () => {
    try {
      const services = createServices();

      console.log('🔧 Duckling System Status\n');

      // Check configuration
      const isConfigured = true; // Always configured since no required settings

      console.log(
        `Configuration: ${isConfigured ? '✅ Complete' : '❌ Incomplete'}`
      );

      if (isConfigured) {
        // Show configuration details
        const defaultTool = services.settings.get('defaultCodingTool');
        console.log(`Default Tool: ${defaultTool || 'Not set'}`);

        // Show task statistics
        const allTasks = services.db.getTasks();
        const pendingTasks = services.db.getTasks({ status: 'pending' });
        const inProgressTasks = services.db.getTasks({ status: 'in-progress' });
        const awaitingReviewTasks = services.db.getTasks({
          status: 'awaiting-review',
        });
        const completedTasks = services.db.getTasks({ status: 'completed' });
        const failedTasks = services.db.getTasks({ status: 'failed' });

        console.log('\n📊 Task Statistics:');
        console.log(`   Total: ${allTasks.length}`);
        console.log(`   Pending: ${pendingTasks.length}`);
        console.log(`   In Progress: ${inProgressTasks.length}`);
        console.log(`   Awaiting Review: ${awaitingReviewTasks.length}`);
        console.log(`   Completed: ${completedTasks.length}`);
        console.log(`   Failed: ${failedTasks.length}`);
      } else {
        console.log(
          '\n💡 Run "duckling start" and visit http://localhost:5050 to complete setup.'
        );
      }

      services.db.close();
    } catch (error: any) {
      console.error('❌ Failed to get status:', error.message);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();
