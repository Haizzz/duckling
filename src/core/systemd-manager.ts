import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface SystemdServiceConfig {
  serviceName: string;
  description: string;
  executablePath: string;
  user: string;
  workingDirectory: string;
  environment?: Record<string, string>;
  port?: number;
}

export class SystemdManager {
  private readonly serviceName = 'duckling';

  /**
   * Install duckling as a systemd user service
   */
  async installService(options: { port?: number } = {}): Promise<void> {
    const port = options.port || 5050;

    // Check if we're on a Linux system with systemd
    this.validateSystemd();

    // Get current user and paths
    const user = os.userInfo().username;
    const executablePath = this.getExecutablePath();
    const workingDirectory = process.cwd();

    const config: SystemdServiceConfig = {
      serviceName: this.serviceName,
      description:
        'Duckling - Automated coding tool that wraps CLI coding assistants',
      executablePath,
      user,
      workingDirectory,
      port,
    };

    // Create systemd service file
    const serviceContent = this.generateServiceFile(config);
    const servicePath = this.getUserServicePath();

    // Ensure systemd user directory exists
    const serviceDir = path.dirname(servicePath);
    if (!fs.existsSync(serviceDir)) {
      fs.mkdirSync(serviceDir, { recursive: true });
    }

    // Write service file
    fs.writeFileSync(servicePath, serviceContent);
    console.log(`📝 Service file created: ${servicePath}`);

    // Enable lingering for the current user (allows user services to run without login)
    try {
      execSync(`sudo loginctl enable-linger ${user}`, { stdio: 'pipe' });
      console.log(`✅ Enabled user lingering for ${user}`);
    } catch (error) {
      console.warn(
        `⚠️ Failed to enable user lingering. Service may not start on boot without user login.`
      );
      console.warn(
        `   You may need to run: sudo loginctl enable-linger ${user}`
      );
    }

    // Reload systemd and enable the service
    try {
      execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
      console.log('🔄 Reloaded systemd daemon');

      execSync(`systemctl --user enable ${this.serviceName}`, {
        stdio: 'pipe',
      });
      console.log(`✅ Service enabled for auto-start`);

      console.log(`\n🎉 Duckling systemd service installed successfully!`);
      console.log(`\nService Management Commands:`);
      console.log(`  Start:   systemctl --user start ${this.serviceName}`);
      console.log(`  Stop:    systemctl --user stop ${this.serviceName}`);
      console.log(`  Restart: systemctl --user restart ${this.serviceName}`);
      console.log(`  Status:  systemctl --user status ${this.serviceName}`);
      console.log(`  Logs:    journalctl --user -u ${this.serviceName} -f`);
      console.log(`\nDuckling will be available at: http://localhost:${port}`);
    } catch (error: any) {
      throw new Error(`Failed to configure systemd service: ${error.message}`);
    }
  }

  /**
   * Uninstall the duckling systemd service
   */
  async uninstallService(): Promise<void> {
    this.validateSystemd();

    const servicePath = this.getUserServicePath();

    if (!fs.existsSync(servicePath)) {
      console.log('❌ Duckling systemd service is not installed');
      return;
    }

    try {
      // Stop the service if running
      try {
        execSync(`systemctl --user stop ${this.serviceName}`, {
          stdio: 'pipe',
        });
        console.log('🛑 Stopped service');
      } catch {
        // Service might not be running, ignore
      }

      // Disable the service
      try {
        execSync(`systemctl --user disable ${this.serviceName}`, {
          stdio: 'pipe',
        });
        console.log('❌ Disabled service auto-start');
      } catch {
        // Service might not be enabled, ignore
      }

      // Remove service file
      fs.unlinkSync(servicePath);
      console.log('🗑️  Removed service file');

      // Reload systemd
      execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
      console.log('🔄 Reloaded systemd daemon');

      console.log(`\n✅ Duckling systemd service uninstalled successfully!`);
    } catch (error: any) {
      throw new Error(`Failed to uninstall systemd service: ${error.message}`);
    }
  }

  /**
   * Check if the service is installed
   */
  isServiceInstalled(): boolean {
    return fs.existsSync(this.getUserServicePath());
  }

  /**
   * Get service status
   */
  async getServiceStatus(): Promise<{
    installed: boolean;
    active: boolean;
    enabled: boolean;
    status?: string;
  }> {
    const installed = this.isServiceInstalled();

    if (!installed) {
      return { installed: false, active: false, enabled: false };
    }

    try {
      // Check if service is active
      let active = false;
      try {
        execSync(`systemctl --user is-active ${this.serviceName}`, {
          stdio: 'pipe',
        });
        active = true;
      } catch {
        active = false;
      }

      // Check if service is enabled
      let enabled = false;
      try {
        execSync(`systemctl --user is-enabled ${this.serviceName}`, {
          stdio: 'pipe',
        });
        enabled = true;
      } catch {
        enabled = false;
      }

      // Get detailed status
      let status = '';
      try {
        status = execSync(`systemctl --user status ${this.serviceName}`, {
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      } catch (error: any) {
        status = error.stdout || 'Status unavailable';
      }

      return { installed, active, enabled, status };
    } catch (error) {
      return { installed, active: false, enabled: false };
    }
  }

  /**
   * Start the service
   */
  async startService(): Promise<void> {
    if (!this.isServiceInstalled()) {
      throw new Error(
        'Service is not installed. Run "duckling service install" first.'
      );
    }

    try {
      execSync(`systemctl --user start ${this.serviceName}`, { stdio: 'pipe' });
      console.log('✅ Service started successfully');
    } catch (error: any) {
      throw new Error(`Failed to start service: ${error.message}`);
    }
  }

  /**
   * Stop the service
   */
  async stopService(): Promise<void> {
    if (!this.isServiceInstalled()) {
      throw new Error('Service is not installed');
    }

    try {
      execSync(`systemctl --user stop ${this.serviceName}`, { stdio: 'pipe' });
      console.log('🛑 Service stopped successfully');
    } catch (error: any) {
      throw new Error(`Failed to stop service: ${error.message}`);
    }
  }

  /**
   * Restart the service
   */
  async restartService(): Promise<void> {
    if (!this.isServiceInstalled()) {
      throw new Error('Service is not installed');
    }

    try {
      execSync(`systemctl --user restart ${this.serviceName}`, {
        stdio: 'pipe',
      });
      console.log('🔄 Service restarted successfully');
    } catch (error: any) {
      throw new Error(`Failed to restart service: ${error.message}`);
    }
  }

  private validateSystemd(): void {
    // Check if we're on Linux
    if (os.platform() !== 'linux') {
      throw new Error('Systemd services are only supported on Linux systems');
    }

    // Check if systemd is available
    try {
      execSync('which systemctl', { stdio: 'pipe' });
    } catch {
      throw new Error(
        'systemctl not found. This system does not appear to have systemd installed.'
      );
    }
  }

  private getExecutablePath(): string {
    // Try to find the duckling executable
    try {
      const result = execSync('which duckling', {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      return result.trim();
    } catch {
      // Fallback to the compiled version
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')
      );
      const binPath = packageJson.bin?.duckling;
      if (binPath) {
        const absolutePath = path.resolve(process.cwd(), binPath);
        if (fs.existsSync(absolutePath)) {
          return absolutePath;
        }
      }

      throw new Error(
        'Could not find duckling executable. Make sure duckling is installed globally or run from the project directory.'
      );
    }
  }

  private getUserServicePath(): string {
    const user = os.userInfo().username;
    const serviceDir = `/home/${user}/.config/systemd/user`;
    return path.join(serviceDir, `${this.serviceName}.service`);
  }

  private generateServiceFile(config: SystemdServiceConfig): string {
    const envVars = config.environment
      ? Object.entries(config.environment)
          .map(([key, value]) => `Environment="${key}=${value}"`)
          .join('\n')
      : '';

    return `[Unit]
Description=${config.description}
After=network.target

[Service]
Type=simple
User=${config.user}
WorkingDirectory=${config.workingDirectory}
ExecStart=${config.executablePath} start${config.port ? ` --port ${config.port}` : ''}
Restart=always
RestartSec=10
${envVars}

# Standard output and error logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${config.serviceName}

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/${config.user}/.duckling

[Install]
WantedBy=default.target
`;
  }
}
