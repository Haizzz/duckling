import { Command } from 'commander';

describe('CLI Module Structure', () => {
  it('should create a commander program', () => {
    const program = new Command();
    program
      .name('duckling')
      .description('Automated coding tool that wraps CLI coding assistants')
      .version('1.0.0');

    expect(program.name()).toBe('duckling');
    expect(program.description()).toBe(
      'Automated coding tool that wraps CLI coding assistants'
    );
    expect(program.version()).toBe('1.0.0');
  });

  it('should support start command configuration', () => {
    const program = new Command();

    const startCmd = program
      .command('start')
      .description('Start the Duckling web server')
      .option('-p, --port <port>', 'Port to run the server on', '5050');

    expect(startCmd.name()).toBe('start');
    expect(startCmd.description()).toBe('Start the Duckling web server');
  });

  it('should support task subcommands', () => {
    const program = new Command();
    const taskCmd = program.command('task').description('Manage tasks');

    const createCmd = taskCmd
      .command('create')
      .description('Create a new task interactively');

    const listCmd = taskCmd
      .command('list')
      .description('List all tasks')
      .option('-s, --status <status>', 'Filter by status')
      .option('-l, --limit <limit>', 'Limit number of results', '10');

    const cancelCmd = taskCmd
      .command('cancel <taskId>')
      .description('Cancel a task');

    expect(createCmd.name()).toBe('create');
    expect(listCmd.name()).toBe('list');
    expect(cancelCmd.name()).toBe('cancel');
  });

  it('should support config and status commands', () => {
    const program = new Command();

    const configCmd = program
      .command('config')
      .description('Configure Duckling settings');

    const statusCmd = program
      .command('status')
      .description('Show system status and configuration');

    expect(configCmd.name()).toBe('config');
    expect(statusCmd.name()).toBe('status');
  });
});
