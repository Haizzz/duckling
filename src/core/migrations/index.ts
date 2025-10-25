/**
 * Database Migration Logic
 *
 * Simple migration system that runs synchronously during database initialization
 */

import type { Database } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

export function runMultiRepositoryMigration(
  db: Database,
  currentWorkingDirectory: string
): void {
  console.log('Running database migrations...');

  // Get current columns in tasks table
  const columns = db.prepare('PRAGMA table_info(tasks)').all() as ColumnInfo[];
  const columnNames = columns.map((col) => col.name);

  // Add missing columns to tasks table
  const columnsToAdd = [
    { name: 'summary', definition: 'summary TEXT' },
    { name: 'current_stage', definition: 'current_stage TEXT' },
    {
      name: 'repository_path',
      definition: "repository_path TEXT NOT NULL DEFAULT ''",
    },
  ];

  for (const column of columnsToAdd) {
    if (!columnNames.includes(column.name)) {
      const sql = `ALTER TABLE tasks ADD COLUMN ${column.definition}`;
      db.exec(sql);
      console.log(`Added ${column.name} column to tasks table`);
    } else {
      console.log(`Column ${column.name} already exists, skipping`);
    }
  }

  // Migrate existing data if we're in a git repository
  try {
    if (fs.existsSync(path.join(currentWorkingDirectory, '.git'))) {
      // Update existing tasks to use the current repository path
      const tasksWithoutRepo = db
        .prepare("SELECT id FROM tasks WHERE repository_path = ''")
        .all();
      if (tasksWithoutRepo.length > 0) {
        db.prepare(
          "UPDATE tasks SET repository_path = ? WHERE repository_path = ''"
        ).run(currentWorkingDirectory);

        console.log(
          `Updated ${tasksWithoutRepo.length} existing tasks to use repository: ${currentWorkingDirectory}`
        );
      }
    }
  } catch (error: unknown) {
    console.warn('Could not migrate existing repository data:', error);
  }

  // Remove category column from settings table if it exists
  try {
    const settingsColumns = db
      .prepare('PRAGMA table_info(settings)')
      .all() as ColumnInfo[];
    const settingsColumnNames = settingsColumns.map((col) => col.name);

    if (settingsColumnNames.includes('category')) {
      console.log('Removing category column from settings table...');

      // SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
      db.exec(`
        BEGIN TRANSACTION;
        
        -- Create new settings table without category column
        CREATE TABLE settings_new (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        -- Copy data from old table to new table
        INSERT INTO settings_new (key, value, updated_at)
        SELECT key, value, updated_at FROM settings;
        
        -- Drop old table and rename new table
        DROP TABLE settings;
        ALTER TABLE settings_new RENAME TO settings;
        
        COMMIT;
      `);

      console.log('Successfully removed category column from settings table');
    } else {
      console.log('Category column not found in settings table, skipping');
    }
  } catch (error: unknown) {
    console.error(
      'Failed to remove category column from settings table:',
      error
    );
    // Don't fail the entire migration if this fails
  }

  console.log('Database migrations completed');
}
