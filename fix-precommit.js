#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), '.duckling', 'duckling.db');

try {
  const db = new Database(dbPath);
  
  // Update the precommit check command from 'fin' to 'lint'
  const updateStmt = db.prepare(`
    UPDATE precommit_checks 
    SET command = REPLACE(command, 'pnpm run fin', 'pnpm run lint')
    WHERE command LIKE '%pnpm run fin%'
  `);
  
  const result = updateStmt.run();
  console.log(`Updated ${result.changes} precommit check(s)`);
  
  // Show current precommit checks
  const selectStmt = db.prepare('SELECT * FROM precommit_checks');
  const checks = selectStmt.all();
  console.log('Current precommit checks:');
  checks.forEach(check => {
    console.log(`- ${check.name}: ${check.command}`);
  });
  
  db.close();
} catch (error) {
  console.error('Error:', error.message);
}