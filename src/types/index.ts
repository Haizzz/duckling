export interface Task {
  id: number;
  title: string;
  description: string;
  summary?: string;
  status: TaskStatus;
  coding_tool: CodingTool;
  repository_path: string;
  current_stage?: string;
  branch_name?: string;
  pr_number?: number;
  pr_url?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export type TaskStatus =
  | 'pending'
  | 'in-progress'
  | 'awaiting-review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type CodingTool = 'openai' | 'amp';

export interface TaskLog {
  id: number;
  task_id: number;
  level: LogLevel;
  message: string;
  timestamp: string;
}

export type LogLevel = 'info' | 'error' | 'debug' | 'warn';

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

export interface PrecommitCheck {
  id: number;
  name: string;
  command: string;
  order_index: number;
  created_at: string;
}

export interface Repository {
  id: number;
  path: string;
  name: string;
  owner: string;
  created_at: string;
}

export interface DucklingSettings {
  // API Keys
  github_token: string;
  openai_api_key?: string;
  amp_api_key?: string;

  // General settings
  default_coding_tool: CodingTool;
  branch_prefix: string;
  pr_prefix: string;
  commit_suffix: string;
  max_retries: number;

  // GitHub settings
  github_username: string;
  poll_interval_seconds: number;
}

export interface TaskUpdateEvent {
  taskId: number;
  status: TaskStatus;
  progress?: number;
  metadata?: Record<string, any>;
  logEntry?: TaskLog;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface CreateTaskRequest {
  title: string;
  description: string;
  codingTool: CodingTool;
  repositoryPath: string;
  branchPrefix?: string;
  prPrefix?: string;
}
