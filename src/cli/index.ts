#!/usr/bin/env node

import { Command } from 'commander';
import { DatabaseManager } from '../core/database';
import { CoreEngine } from '../core/engine';
import { CreateTaskRequest } from '../types';
import { startIntern } from '../index';

const program = new Command();

program
  .name('intern')
  .description('Automated coding tool that wraps CLI coding assistants')
  .version('1.0.0');

// Start command - launch the web server
program
  .command('start')
  .description('Start the Intern web server')
  .option('-p, --port <port>', 'Port to run the server on', '5050')
  .action(async (options) => {
    try {
      const port = parseInt(options.port);
      await startIntern(port);
    } catch (error: any) {
      console.error('❌ Failed to start Intern:', error.message);
      process.exit(1);
    }
  });

// Config command - initial setup
program
  .command('config')
  .description('Configure Intern settings')
  .action(async () => {
    try {
      const db = new DatabaseManager();

      // Check if already configured
      const githubToken = db.getSetting('github_token');
      if (githubToken) {
        console.log('✅ Intern is already configured. Use "intern start" to run the server.');
        console.log('💡 You can modify settings through the web interface at http://localhost:5050/settings');
        return;
      }

      console.log('🔧 Intern needs to be configured through the web interface.');
      console.log('📝 Run "intern start" and visit http://localhost:5050 to complete setup.');

    } catch (error: any) {
      console.error('❌ Failed to check configuration:', error.message);
      process.exit(1);
    }
  });

// Task command group
const taskCmd = program
  .command('task')
  .description('Manage tasks');

// Create task command
taskCmd
  .command('create')
  .description('Create a new task interactively')
  .action(async () => {
    try {
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const question = (prompt: string): Promise<string> => {
        return new Promise(resolve => {
          readline.question(prompt, resolve);
        });
      };

      console.log('📝 Creating a new task...\n');

      const title = await question('Task title: ');
      if (!title.trim()) {
        console.log('❌ Task title is required');
        readline.close();
        return;
      }

      const description = await question('Task description: ');
      if (!description.trim()) {
        console.log('❌ Task description is required');
        readline.close();
        return;
      }

      const codingTool = await question('Coding tool (amp/openai/claude) [amp]: ') || 'amp';
      if (!['amp', 'openai', 'claude'].includes(codingTool)) {
        console.log('❌ Invalid coding tool. Use: amp, openai, or claude');
        readline.close();
        return;
      }

      readline.close();

      const db = new DatabaseManager();
      const engine = new CoreEngine(db);
      await engine.initialize();

      const taskRequest: CreateTaskRequest = {
        title: title.trim(),
        description: description.trim(),
        codingTool: codingTool as any
      };

      const taskId = await engine.createTask(taskRequest);

      console.log(`\n✅ Task created successfully!`);
      console.log(`📋 Task ID: ${taskId}`);
      console.log(`🔗 View task: http://localhost:5050/task/${taskId}`);

      engine.shutdown();
      db.close();

    } catch (error: any) {
      console.error('❌ Failed to create task:', error.message);
      process.exit(1);
    }
  });

// List tasks command
taskCmd
  .command('list')
  .description('List all tasks')
  .option('-s, --status <status>', 'Filter by status (pending/in-progress/awaiting-review/completed/failed/cancelled)')
  .option('-l, --limit <limit>', 'Limit number of results', '10')
  .action(async (options) => {
    try {
      const db = new DatabaseManager();

      const filters: any = {
        limit: parseInt(options.limit)
      };

      if (options.status) {
        filters.status = options.status;
      }

      const tasks = db.getTasks(filters);

      if (tasks.length === 0) {
        console.log('📭 No tasks found');
        return;
      }

      console.log(`📋 Found ${tasks.length} task(s):\n`);

      tasks.forEach(task => {
        const statusEmoji = {
          'pending': '⏳',
          'in-progress': '🔄',
          'awaiting-review': '👀',
          'completed': '✅',
          'failed': '❌',
          'cancelled': '🚫'
        }[task.status] || '❓';

        console.log(`${statusEmoji} ${task.title}`);
        console.log(`   ID: ${task.id}`);
        console.log(`   Status: ${task.status}`);
        console.log(`   Tool: ${task.coding_tool}`);
        console.log(`   Created: ${new Date(task.created_at).toLocaleString()}`);
        if (task.pr_url) {
          console.log(`   PR: ${task.pr_url}`);
        }
        console.log('');
      });

      db.close();

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
      const db = new DatabaseManager();
      const engine = new CoreEngine(db);
      await engine.initialize();

      const task = db.getTask(parseInt(taskId));
      if (!task) {
        console.log(`❌ Task not found: ${taskId}`);
        engine.shutdown();
        db.close();
        return;
      }

      if (task.status === 'completed' || task.status === 'cancelled') {
        console.log(`❌ Cannot cancel task in status: ${task.status}`);
        engine.shutdown();
        db.close();
        return;
      }

      await engine.cancelTask(parseInt(taskId));

      console.log(`✅ Task cancelled: ${task.title}`);

      engine.shutdown();
      db.close();

    } catch (error: any) {
      console.error('❌ Failed to cancel task:', error.message);
      process.exit(1);
    }
  });

// Status command - show system status
program
  .command('status')
  .description('Show system status and configuration')
  .action(async () => {
    try {
      const db = new DatabaseManager();

      console.log('🔧 Intern System Status\n');

      // Check configuration
      const githubToken = db.getSetting('github_token');
      const isConfigured = !!githubToken;

      console.log(`Configuration: ${isConfigured ? '✅ Complete' : '❌ Incomplete'}`);

      if (isConfigured) {
        // Show configuration details
        const githubToken = db.getSetting('githubToken');
        const defaultTool = db.getSetting('defaultCodingTool');
        console.log(`GitHub Token: ${githubToken ? '✅ Set' : '❌ Not set'}`);
        console.log(`Default Tool: ${defaultTool?.value || 'Not set'}`);

        // Show task statistics
        const allTasks = db.getTasks();
        const pendingTasks = db.getTasks({ status: 'pending' });
        const inProgressTasks = db.getTasks({ status: 'in-progress' });
        const awaitingReviewTasks = db.getTasks({ status: 'awaiting-review' });
        const completedTasks = db.getTasks({ status: 'completed' });
        const failedTasks = db.getTasks({ status: 'failed' });

        console.log('\n📊 Task Statistics:');
        console.log(`   Total: ${allTasks.length}`);
        console.log(`   Pending: ${pendingTasks.length}`);
        console.log(`   In Progress: ${inProgressTasks.length}`);
        console.log(`   Awaiting Review: ${awaitingReviewTasks.length}`);
        console.log(`   Completed: ${completedTasks.length}`);
        console.log(`   Failed: ${failedTasks.length}`);
      } else {
        console.log('\n💡 Run "intern start" and visit http://localhost:5050 to complete setup.');
      }

      db.close();

    } catch (error: any) {
      console.error('❌ Failed to get status:', error.message);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();
