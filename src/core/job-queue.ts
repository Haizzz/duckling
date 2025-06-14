import { DatabaseManager } from './database';
import { Job, JobStatus } from '../types';
import { logger } from '../utils/logger';

export class SQLiteJobQueue {
  private db: DatabaseManager;
  private workers: Map<string, NodeJS.Timeout> = new Map();
  private isShuttingDown = false;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  enqueue(
    type: string,
    data: any,
    options: { delay?: number; maxAttempts?: number } = {}
  ): string {
    return this.db.enqueueJob(type, data, options);
  }

  process(type: string, handler: (data: any) => Promise<void>): void {
    logger.info(`Starting worker for type ${type}`);
    if (this.workers.has(type)) {
      return; // Worker already running for this type
    }

    const worker = setInterval(async () => {
      if (this.isShuttingDown) {
        return;
      }

      try {
        const job = this.getNextJob(type);
        if (job) {
          logger.info(`Worker for type ${type} found job: ${job?.id}`);
          await this.executeJob(job, handler);
        }
      } catch (error) {
        logger.error(`Worker error for type ${type}: ${error}`);
      }
    }, 5000);

    this.workers.set(type, worker);
  }

  private getNextJob(type: string): Job | null {
    return this.db.getNextJob(type);
  }

  private async executeJob(job: Job, handler: (data: any) => Promise<void>): Promise<void> {
    // Mark as processing
    this.db.updateJobStatus(job.id.toString(), 'processing');

    try {
      await handler(JSON.parse(job.data));
      // Mark as completed
      this.db.updateJobStatus(job.id.toString(), 'completed');

    } catch (error) {
      await this.handleJobFailure(job, error as Error);
    }
  }

  private async handleJobFailure(job: Job, error: Error): Promise<void> {
    const nextAttempt = job.attempts + 1;

    if (nextAttempt >= job.max_attempts) {
      // Max attempts reached
      this.db.updateJobStatus(job.id.toString(), 'failed', error.message);
    } else {
      // Schedule retry
      const backoffDelay = Math.pow(2, nextAttempt) * 1000; // Exponential backoff
      const retryAt = new Date(Date.now() + backoffDelay).toISOString();
      this.db.incrementJobAttempts(job.id.toString(), retryAt);
    }
  }



  getJob(id: string): Job | null {
    const stmt = this.db['db'].prepare('SELECT * FROM jobs WHERE id = ?');
    return stmt.get(id) as Job | null;
  }

  getJobs(type?: string, status?: JobStatus): Job[] {
    let query = 'SELECT * FROM jobs';
    const params: any[] = [];
    const conditions: string[] = [];

    if (type) {
      conditions.push('type = ?');
      params.push(type);
    }

    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC';

    const stmt = this.db['db'].prepare(query);
    return stmt.all(...params) as Job[];
  }

  // Get jobs that were in progress when server stopped
  getIncompleteJobs(): Job[] {
    const stmt = this.db['db'].prepare(`
      SELECT * FROM jobs 
      WHERE status IN ('pending', 'processing')
      ORDER BY created_at ASC
    `);
    return stmt.all() as Job[];
  }

  // Reset processing jobs to pending (for startup recovery)
  resetProcessingJobs(): void {
    this.db.resetProcessingJobs();
  }

  shutdown(): void {
    this.isShuttingDown = true;

    // Clear all workers
    for (const [type, worker] of this.workers) {
      clearInterval(worker);
    }
    this.workers.clear();
  }
}
