#!/usr/bin/env node

import { Command } from 'commander';
import { DatabaseManager } from '../core/database';
import { CoreEngine } from '../core/engine';
import { CodingTool, CreateTaskRequest } from '../types';
import { startDuckling } from '../index';
import * as readline from 'readline';
import { SettingsManager } from '../core/settings-manager';
import { exec as childExec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

const program = new Command();

// Helper function to execute commands
const exec = promisify(childExec);

// Helper function to create readline interface
const createReadline = () => {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
};

// Helper function to ask questions
const question = (rl: readline.Interface, prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
};

// Helper function to detect if a command exists
const commandExists = async (command: string): Promise<boolean> => {
  try {
    const checkCommand = os.platform() === 'win32' ? 'where' : 'which';
    await exec(`${checkCommand} ${command}`);
    return true;
  } catch {
    return false;
  }
};

// Helper function to detect platform
const detectPlatform = (): string => {
  const platform = os.platform();
  switch (platform) {
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      return 'unknown';
  }
};

// Helper function to install GitHub CLI
const installGitHubCLI = async (): Promise<boolean> => {
  const platform = detectPlatform();
  
  console.log(`🔧 Installing GitHub CLI for ${platform}...`);
  
  try {
    switch (platform) {
      case 'macos':
        await exec('brew install gh');
        break;
      case 'linux':
        await exec('sudo snap install gh');
        break;
      case 'windows':
        await exec('winget install GitHub.cli');
        break;
      default:
        console.log('❌ Unsupported platform for automatic installation');
        return false;
    }
    
    console.log('✅ GitHub CLI installed successfully!');
    return true;
  } catch (error: any) {
    console.log(`❌ Failed to install GitHub CLI: ${error.message}`);
    return false;
  }
};

// Helper function to install coding tools
const installCodingTool = async (tool: 'amp' | 'codex'): Promise<boolean> => {
  console.log(`🔧 Installing ${tool}...`);
  
  try {
    switch (tool) {
      case 'amp':
        await exec('npm install -g @sourcegraph/amp');
        break;
      case 'codex':
        await exec('npm install -g @openai/codex');
        break;
    }
    
    console.log(`✅ ${tool} installed successfully!`);
    return true;
  } catch (error: any) {
    console.log(`❌ Failed to install ${tool}: ${error.message}`);
    return false;
  }
};

program
  .name('duckling')
  .description('Automated coding tool that wraps CLI coding assistants')
  .version('1.0.0');

// Onboard command - interactive setup
program
  .command('onboard')
  .description('Interactive setup and configuration of Duckling')
  .action(async () => {
    const rl = createReadline();
    
    try {
      console.log('🦆 Welcome to Duckling! Let\'s get you set up.\n');
      
      const db = new DatabaseManager();
      const settings = new SettingsManager(db);
      
      // Check if already configured
      const repositoryUrl = settings.get('repositoryUrl');
      if (repositoryUrl) {
        const continueSetup = await question(rl, 
          '⚠️  Duckling is already configured. Do you want to reconfigure? (y/N): '
        );
        if (!continueSetup.toLowerCase().startsWith('y')) {
          console.log('Setup cancelled.');
          rl.close();
          db.close();
          return;
        }
      }
      
      // 1. Check and install GitHub CLI
      console.log('🔍 Checking for GitHub CLI...');
      const hasGitHubCLI = await commandExists('gh');
      
      if (!hasGitHubCLI) {
        console.log('❌ GitHub CLI not found');
        const installGH = await question(rl, 
          '📦 Would you like to install GitHub CLI automatically? (Y/n): '
        );
        
        if (!installGH.toLowerCase().startsWith('n')) {
          const installed = await installGitHubCLI();
          if (!installed) {
            console.log('❌ Please install GitHub CLI manually from https://cli.github.com/');
            rl.close();
            db.close();
            return;
          }
        } else {
          console.log('❌ GitHub CLI is required. Please install it manually from https://cli.github.com/');
          rl.close();
          db.close();
          return;
        }
      } else {
        console.log('✅ GitHub CLI found');
      }
      
      // Authenticate with GitHub
      console.log('\n🔐 Authenticating with GitHub...');
      const authResult = await question(rl, 
        '🔑 Run GitHub authentication? This will open a browser window (Y/n): '
      );
      
      if (!authResult.toLowerCase().startsWith('n')) {
        try {
          const { spawn } = require('child_process');
          const authProcess = spawn('gh', ['auth', 'login'], { stdio: 'inherit' });
          await new Promise<void>((resolve, reject) => {
            authProcess.on('close', (code: number) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`gh auth login exited with code ${code}`));
              }
            });
          });
          console.log('✅ GitHub authentication completed!');
        } catch (error: any) {
          console.log(`❌ GitHub authentication failed: ${error.message}`);
          const continueAnyway = await question(rl, 
            '⚠️  Continue setup anyway? (y/N): '
          );
          if (!continueAnyway.toLowerCase().startsWith('y')) {
            rl.close();
            db.close();
            return;
          }
        }
      }
      
      // 2. Check and install coding tools
      console.log('\n🔍 Checking for coding tools...');
      const hasAmp = await commandExists('amp');
      const hasCodex = await commandExists('codex');
      
      console.log(`Amp: ${hasAmp ? '✅ Found' : '❌ Not found'}`);
      console.log(`Codex: ${hasCodex ? '✅ Found' : '❌ Not found'}`);
      
      if (!hasAmp && !hasCodex) {
        console.log('\n❌ No coding tools found');
        const toolToInstall = await question(rl, 
          '📦 Which coding tool would you like to install? (amp/codex/skip): '
        );
        
        if (toolToInstall.toLowerCase() === 'amp') {
          await installCodingTool('amp');
        } else if (toolToInstall.toLowerCase() === 'codex') {
          await installCodingTool('codex');
        } else if (toolToInstall.toLowerCase() !== 'skip') {
          console.log('❌ Invalid choice. Skipping tool installation.');
        }
      }
      
      // 3. Configure settings
      console.log('\n⚙️  Configuring settings...\n');
      
      // Repository URL (required)
      let repoUrl = '';
      while (!repoUrl) {
        repoUrl = await question(rl, 
          '📁 Repository URL (required): '
        );
        if (!repoUrl.trim()) {
          console.log('❌ Repository URL is required');
        }
      }
      settings.set('repositoryUrl', repoUrl.trim());
      
      // Default coding tool
      const defaultTool = await question(rl, 
        `🔧 Default coding tool [${settings.get('defaultCodingTool')}]: `
      );
      if (defaultTool.trim() && ['amp', 'openai'].includes(defaultTool.trim().toLowerCase())) {
        settings.set('defaultCodingTool', defaultTool.trim().toLowerCase() as CodingTool);
      }
      
      // Branch prefix
      const branchPrefix = await question(rl, 
        `🌳 Branch prefix [${settings.get('branchPrefix')}]: `
      );
      if (branchPrefix.trim()) {
        settings.set('branchPrefix', branchPrefix.trim());
      }
      
      // PR title prefix
      const prTitlePrefix = await question(rl, 
        `📝 PR title prefix [${settings.get('prTitlePrefix')}]: `
      );
      if (prTitlePrefix.trim()) {
        settings.set('prTitlePrefix', prTitlePrefix.trim());
      }
      
      // Commit suffix
      const commitSuffix = await question(rl, 
        `📝 Commit suffix [${settings.get('commitSuffix')}]: `
      );
      if (commitSuffix.trim()) {
        settings.set('commitSuffix', commitSuffix.trim());
      }
      
      // Max retries
      const maxRetries = await question(rl, 
        `🔄 Max retries [${settings.get('maxRetries')}]: `
      );
      if (maxRetries.trim() && !isNaN(parseInt(maxRetries.trim()))) {
        settings.set('maxRetries', parseInt(maxRetries.trim()));
      }
      
      // API Keys
      if (settings.get('defaultCodingTool') === 'amp' || await question(rl, 
        '🔑 Configure Amp API key? (y/N): '
      ).then(r => r.toLowerCase().startsWith('y'))) {
        let ampApiKey = '';
        while (!ampApiKey && settings.get('defaultCodingTool') === 'amp') {
          ampApiKey = await question(rl, 
            '🔑 Amp API key (required for Amp): '
          );
          if (!ampApiKey.trim() && settings.get('defaultCodingTool') === 'amp') {
            console.log('❌ Amp API key is required when using Amp as default tool');
          }
        }
        if (ampApiKey.trim()) {
          settings.set('ampApiKey', ampApiKey.trim());
        }
      }
      
      if (settings.get('defaultCodingTool') === 'openai' || await question(rl, 
        '🔑 Configure OpenAI API key? (y/N): '
      ).then(r => r.toLowerCase().startsWith('y'))) {
        let openaiApiKey = '';
        while (!openaiApiKey && settings.get('defaultCodingTool') === 'openai') {
          openaiApiKey = await question(rl, 
            '🔑 OpenAI API key (required for OpenAI): '
          );
          if (!openaiApiKey.trim() && settings.get('defaultCodingTool') === 'openai') {
            console.log('❌ OpenAI API key is required when using OpenAI as default tool');
          }
        }
        if (openaiApiKey.trim()) {
          settings.set('openaiApiKey', openaiApiKey.trim());
        }
      }
      
      console.log('\n✅ Setup completed successfully!');
      console.log('\n🚀 You can now start Duckling with: duckling start');
      console.log('🌐 Or visit http://localhost:5050 to manage tasks');
      
      rl.close();
      db.close();
    } catch (error: any) {
      console.error('❌ Setup failed:', error.message);
      rl.close();
      process.exit(1);
    }
  });

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
      const db = new DatabaseManager();

      // Check if already configured
      const repositoryUrl = db.getSetting('repositoryUrl');
      if (repositoryUrl) {
        console.log(
          '✅ Duckling is already configured. Use "duckling start" to run the server.'
        );
        console.log(
          '💡 You can modify settings through the web interface at http://localhost:5050/settings'
        );
        return;
      }

      console.log(
        '🔧 Duckling needs to be configured through the web interface.'
      );
      console.log(
        '📝 Run "duckling start" and visit http://localhost:5050 to complete setup.'
      );
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
        (await question('Coding tool (amp/openai) [amp]: ')) || 'amp';
      if (!['amp', 'openai'].includes(codingTool)) {
        console.log('❌ Invalid coding tool. Use: amp or openai');
        rl.close();
        return;
      }

      rl.close();

      const db = new DatabaseManager();
      const engine = new CoreEngine(db);
      await engine.initialize();

      const taskRequest: CreateTaskRequest = {
        title: title.trim(),
        description: description.trim(),
        codingTool: codingTool as CodingTool,
        repositoryPath: process.cwd(), // Use current directory for CLI
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
  .option(
    '-s, --status <status>',
    'Filter by status (pending/in-progress/awaiting-review/completed/failed/cancelled)'
  )
  .option('-l, --limit <limit>', 'Limit number of results', '10')
  .action(async (options) => {
    try {
      const db = new DatabaseManager();

      const filters: any = {
        limit: parseInt(options.limit),
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

      tasks.forEach((task) => {
        const statusEmoji =
          {
            pending: '⏳',
            'in-progress': '🔄',
            'awaiting-review': '👀',
            completed: '✅',
            failed: '❌',
            cancelled: '🚫',
          }[task.status] || '❓';

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

      console.log('🔧 Duckling System Status\n');

      // Check configuration
      const repositoryUrl = db.getSetting('repositoryUrl');
      const isConfigured = !!repositoryUrl;

      console.log(
        `Configuration: ${isConfigured ? '✅ Complete' : '❌ Incomplete'}`
      );

      if (isConfigured) {
        // Show configuration details
        const defaultTool = db.getSetting('defaultCodingTool');
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
        console.log(
          '\n💡 Run "duckling start" and visit http://localhost:5050 to complete setup.'
        );
      }

      db.close();
    } catch (error: any) {
      console.error('❌ Failed to get status:', error.message);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();
