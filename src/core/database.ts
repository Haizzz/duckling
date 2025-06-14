import Database from 'better-sqlite3';
import fs from 'fs';
import { Task, TaskLog, Setting, PrecommitCheck, SystemConfig, Job } from '../types';
import { INTERN_DIR, DATABASE_PATH, DEFAULT_SETTINGS } from '../utils/constants';
import { logger } from '../utils/logger';

export class DatabaseManager {
  private db: Database.Database;
  private dbPath: string;

  constructor() {
    // Ensure directory exists
    if (!fs.existsSync(INTERN_DIR)) {
      fs.mkdirSync(INTERN_DIR, { recursive: true });
    }

    this.dbPath = DATABASE_PATH;
    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    this.initTables();
  }

  private initTables(): void {
    // Tasks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        coding_tool TEXT NOT NULL,
        branch_name TEXT,
        pr_number INTEGER,
        pr_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME
      )
    `);

    // Add new columns if they don't exist (for existing databases)
    try {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN summary TEXT`);
    } catch (e) {
      // Column already exists, ignore
    }

    try {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN current_stage TEXT`);
    } catch (e) {
      // Column already exists, ignore
    }

    // Task logs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      )
    `);

    // Settings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        category TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Precommit checks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS precommit_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        command TEXT NOT NULL,
        required BOOLEAN DEFAULT 1,
        enabled BOOLEAN DEFAULT 1,
        order_index INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // System config table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Jobs table for the queue
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME,
        failed_at DATETIME,
        error TEXT
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON jobs(type, status);
      CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_at ON jobs(scheduled_at);
    `);

    // Initialize default settings if not exists
    this.initDefaultSettings();
  }

  private initDefaultSettings(): void {
    const defaultSettings = [
      { key: 'defaultCodingTool', value: 'amp', category: 'general' },
      { key: 'branchPrefix', value: DEFAULT_SETTINGS.branchPrefix, category: 'general' },
      { key: 'prTitlePrefix', value: DEFAULT_SETTINGS.prTitlePrefix, category: 'general' },
      { key: 'commitSuffix', value: DEFAULT_SETTINGS.commitSuffix, category: 'general' },
      { key: 'maxRetries', value: DEFAULT_SETTINGS.maxRetries.toString(), category: 'general' },
      { key: 'baseBranch', value: DEFAULT_SETTINGS.baseBranch, category: 'general' },
      { key: 'pollInterval', value: DEFAULT_SETTINGS.pollInterval.toString(), category: 'general' },
      { key: 'taskCheckInterval', value: DEFAULT_SETTINGS.taskCheckInterval.toString(), category: 'general' },
      { key: 'reviewCheckInterval', value: DEFAULT_SETTINGS.reviewCheckInterval.toString(), category: 'general' },
      { key: 'onboarding_completed', value: 'false', category: 'general' },
    ];

    const insertSetting = this.db.prepare(`
      INSERT OR IGNORE INTO settings (key, value, category) 
      VALUES (?, ?, ?)
    `);

    for (const setting of defaultSettings) {
      insertSetting.run(setting.key, setting.value, setting.category);
    }

    // No default precommit checks - user configures them
  }

  // Task operations
  createTask(task: Omit<Task, 'created_at' | 'updated_at'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, title, description, summary, status, coding_tool, current_stage, branch_name, pr_number, pr_url, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      task.id,
      task.title,
      task.description,
      task.summary || null,
      task.status,
      task.coding_tool,
      task.current_stage || null,
      task.branch_name || null,
      task.pr_number || null,
      task.pr_url || null,
      task.completed_at || null
    );
  }

  updateTask(id: string, updates: Partial<Task>): void {
    const fields = Object.keys(updates).filter(key => key !== 'id');
    if (fields.length === 0) return;

    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = fields.map(field => (updates as any)[field]);

    const stmt = this.db.prepare(`
      UPDATE tasks 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);

    stmt.run(...values, id);
  }

  getTask(id: string): Task | null {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    return stmt.get(id) as Task | null;
  }

  getTasks(
    filters: { status?: string; limit?: number; offset?: number } = {}
  ): Task[] {
    let query = 'SELECT * FROM tasks';
    const params: any[] = [];

    if (filters.status && filters.status !== 'all') {
      query += ' WHERE status = ?';
      params.push(filters.status);
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);

      if (filters.offset) {
        query += ' OFFSET ?';
        params.push(filters.offset);
      }
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as Task[];
  }

  deleteTask(id: string): void {
    // Delete task logs first
    this.db.prepare('DELETE FROM task_logs WHERE task_id = ?').run(id);

    // Delete task
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  // Task logs operations
  addTaskLog(log: Omit<TaskLog, 'id' | 'timestamp'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO task_logs (task_id, level, message)
      VALUES (?, ?, ?)
    `);

    stmt.run(log.task_id, log.level, log.message);
  }

  getTaskLogs(
    taskId: string,
    filters: { level?: string; limit?: number; offset?: number } = {}
  ): TaskLog[] {
    let query = 'SELECT * FROM task_logs WHERE task_id = ?';
    const params: any[] = [taskId];

    if (filters.level && filters.level !== 'all') {
      query += ' AND level = ?';
      params.push(filters.level);
    }

    query += ' ORDER BY timestamp DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);

      if (filters.offset) {
        query += ' OFFSET ?';
        params.push(filters.offset);
      }
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as TaskLog[];
  }

  // Settings operations
  getSetting(key: string): Setting | null {
    const stmt = this.db.prepare('SELECT * FROM settings WHERE key = ?');
    return stmt.get(key) as Setting | null;
  }

  getSettings(category?: string): Setting[] {
    let query = 'SELECT * FROM settings';
    const params: any[] = [];

    if (category) {
      query += ' WHERE category = ?';
      params.push(category);
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as Setting[];
  }

  setSetting(key: string, value: string, category: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, category, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);

    stmt.run(key, value, category);
  }

  // System config operations
  getSystemConfig(key: string): SystemConfig | null {
    const stmt = this.db.prepare('SELECT * FROM system_config WHERE key = ?');
    return stmt.get(key) as SystemConfig | null;
  }

  setSystemConfig(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO system_config (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);

    stmt.run(key, value);
  }

  // Job queue operations
  enqueueJob(type: string, data: any, options: { delay?: number; maxAttempts?: number } = {}): string {
    const jobId = Date.now().toString(36) + Math.random().toString(36).substr(2);

    const stmt = this.db.prepare(`
      INSERT INTO jobs (id, type, data, status, attempts, max_attempts, created_at, scheduled_at)
      VALUES (?, ?, ?, 'pending', 0, ?, datetime('now'), ?)
    `);

    const scheduledAt = options.delay ?
      new Date(Date.now() + options.delay).toISOString() :
      new Date().toISOString();

    stmt.run(
      jobId,
      type,
      JSON.stringify(data),
      options.maxAttempts || 3,
      scheduledAt
    );

    return jobId;
  }

  getNextJob(type: string): Job | null {
    const stmt = this.db.prepare(`
      SELECT * FROM jobs 
      WHERE type = ? AND status = 'pending' 
      AND scheduled_at <= datetime('now')
      AND attempts < max_attempts
      ORDER BY created_at ASC 
      LIMIT 1
    `);

    return stmt.get(type) as Job | null;
  }

  updateJobStatus(jobId: string, status: string, error?: string): void {
    if (status === 'completed') {
      const stmt = this.db.prepare(`
        UPDATE jobs SET status = 'completed', processed_at = datetime('now') 
        WHERE id = ?
      `);
      stmt.run(jobId);
    } else if (status === 'failed') {
      const stmt = this.db.prepare(`
        UPDATE jobs SET status = 'failed', failed_at = datetime('now'), error = ?
        WHERE id = ?
      `);
      stmt.run(error || '', jobId);
    } else {
      const stmt = this.db.prepare(`UPDATE jobs SET status = ? WHERE id = ?`);
      stmt.run(status, jobId);
    }
  }

  incrementJobAttempts(jobId: string, nextScheduledAt?: string): void {
    const stmt = this.db.prepare(`
      UPDATE jobs 
      SET attempts = attempts + 1, status = 'pending', scheduled_at = ?
      WHERE id = ?
    `);

    const scheduledAt = nextScheduledAt || new Date().toISOString();
    stmt.run(scheduledAt, jobId);
  }

  resetProcessingJobs(): void {
    const stmt = this.db.prepare(`
      UPDATE jobs 
      SET status = 'pending', scheduled_at = datetime('now')
      WHERE status = 'processing'
    `);
    stmt.run();
  }

  // Precommit check operations
  addPrecommitCheck(check: Omit<PrecommitCheck, 'id' | 'created_at'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO precommit_checks (name, command, required, enabled, order_index)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      check.name,
      check.command,
      check.required ? 1 : 0,
      check.enabled ? 1 : 0,
      check.order_index
    );

    return result.lastInsertRowid as number;
  }

  updatePrecommitCheck(id: number, updates: Partial<PrecommitCheck>): void {
    const fields = Object.keys(updates).filter(key =>
      key !== 'id' && key !== 'created_at'
    );

    if (fields.length === 0) return;

    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = fields.map(field => {
      const value = (updates as any)[field];
      if (field === 'required' || field === 'enabled') {
        return value ? 1 : 0;
      }
      return value;
    });

    const stmt = this.db.prepare(`
      UPDATE precommit_checks 
      SET ${setClause}
      WHERE id = ?
    `);

    stmt.run(...values, id);
  }

  deletePrecommitCheck(id: number): void {
    const stmt = this.db.prepare('DELETE FROM precommit_checks WHERE id = ?');
    stmt.run(id);
  }

  getEnabledPrecommitChecks(): PrecommitCheck[] {
    const stmt = this.db.prepare(`
      SELECT * FROM precommit_checks 
      WHERE enabled = 1 
      ORDER BY order_index ASC
    `);

    return stmt.all() as PrecommitCheck[];
  }

  getAllPrecommitChecks(): PrecommitCheck[] {
    const stmt = this.db.prepare(`
      SELECT * FROM precommit_checks 
      ORDER BY order_index ASC
    `);

    return stmt.all() as PrecommitCheck[];
  }

  close(): void {
    this.db.close();
  }
}

export const db = new DatabaseManager();
