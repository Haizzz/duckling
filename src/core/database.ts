import Database from 'better-sqlite3';
import fs from 'fs';
import { Task, TaskLog, Setting, PrecommitCheck } from '../types';
import {
  DUCKLING_DIR,
  DATABASE_PATH,
  DEFAULT_SETTINGS,
} from '../utils/constants';

export class DatabaseManager {
  private db: Database.Database;
  private dbPath: string;

  constructor() {
    // Ensure directory exists
    if (!fs.existsSync(DUCKLING_DIR)) {
      fs.mkdirSync(DUCKLING_DIR, { recursive: true });
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
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        task_id INTEGER NOT NULL,
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
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Precommit checks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS precommit_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        command TEXT NOT NULL,
        order_index INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id);
    `);

    // Initialize default settings if not exists
    this.initDefaultSettings();
  }

  private initDefaultSettings(): void {
    const defaultSettings = [
      { key: 'defaultCodingTool', value: 'amp' },
      { key: 'branchPrefix', value: DEFAULT_SETTINGS.branchPrefix },
      { key: 'prTitlePrefix', value: DEFAULT_SETTINGS.prTitlePrefix },
      { key: 'commitSuffix', value: DEFAULT_SETTINGS.commitSuffix },
      { key: 'maxRetries', value: DEFAULT_SETTINGS.maxRetries.toString() },
      { key: 'baseBranch', value: DEFAULT_SETTINGS.baseBranch },
    ];

    const insertSetting = this.db.prepare(`
      INSERT OR IGNORE INTO settings (key, value) 
      VALUES (?, ?)
    `);

    for (const setting of defaultSettings) {
      insertSetting.run(setting.key, setting.value);
    }

    // No default precommit checks - user configures them
  }

  // Task operations
  createTask(task: Omit<Task, 'id' | 'created_at' | 'updated_at'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (title, description, summary, status, coding_tool, current_stage, branch_name, pr_number, pr_url, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
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

    return result.lastInsertRowid as number;
  }

  updateTask(id: number, updates: Partial<Task>): void {
    const fields = Object.keys(updates).filter((key) => key !== 'id');
    if (fields.length === 0) return;

    const setClause = fields.map((field) => `${field} = ?`).join(', ');
    const values = fields.map((field) => (updates as any)[field]);

    const stmt = this.db.prepare(`
      UPDATE tasks 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);

    stmt.run(...values, id);
  }

  getTask(id: number): Task | null {
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

  deleteTask(id: number): void {
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
    taskId: number,
    filters: {
      level?: string;
      limit?: number;
      offset?: number;
      after?: number;
    } = {}
  ): TaskLog[] {
    let query = 'SELECT * FROM task_logs WHERE task_id = ?';
    const params: any[] = [taskId];

    if (filters.level && filters.level !== 'all') {
      query += ' AND level = ?';
      params.push(filters.level);
    }

    if (filters.after) {
      query += ' AND id > ?';
      params.push(filters.after);
    }

    query += ' ORDER BY timestamp ASC';

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

  getSettings(): Setting[] {
    const stmt = this.db.prepare('SELECT * FROM settings');
    return stmt.all() as Setting[];
  }

  setSetting(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);

    stmt.run(key, value);
  }

  // Precommit check operations
  addPrecommitCheck(check: Omit<PrecommitCheck, 'id' | 'created_at'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO precommit_checks (name, command, order_index)
      VALUES (?, ?, ?)
    `);

    const result = stmt.run(check.name, check.command, check.order_index);

    return result.lastInsertRowid as number;
  }

  updatePrecommitCheck(id: number, updates: Partial<PrecommitCheck>): void {
    const fields = Object.keys(updates).filter(
      (key) => key !== 'id' && key !== 'created_at'
    );

    if (fields.length === 0) return;

    const setClause = fields.map((field) => `${field} = ?`).join(', ');
    const values = fields.map((field) => (updates as any)[field]);

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
