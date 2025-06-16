/**
 * Database Migration Logic
 *
 * Simple migration system that runs synchronously during database initialization
 */

import type { Database } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export function runMultiRepositoryMigration(
  db: Database,
  currentWorkingDirectory: string
): void {
  console.log('Running database migrations...');

  // Get current columns in tasks table
  const columns = db.prepare('PRAGMA table_info(tasks)').all();
  const columnNames = columns.map((col: any) => col.name);

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
      console.log(`Executing SQL: ${sql}`);
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
  } catch (error) {
    console.warn('Could not migrate existing repository data:', error);
  }

  console.log('Database migrations completed');
}
