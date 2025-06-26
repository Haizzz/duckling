// Task detail page functionality
class TaskDetail {
  constructor() {
    this.taskId = this.getTaskIdFromUrl();
    this.logRefreshInterval = null;
    this.currentTask = null;
    this.taskUpdateHandler = null;
    this.lastLogId = 0; // Track last loaded log ID for incremental loading
    this.logs = []; // Cache logs to avoid full re-render
    this.repositories = []; // Repository data for display

    if (this.taskId) {
      this.loadRepositories();
      this.loadTaskDetail();
      this.startLogRefresh();
      this.startEventStream();
    } else {
      this.showError('No task ID provided');
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      this.stopLogRefresh();
      this.stopEventStream();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!target.closest('#task-actions-menu') && !target.closest('#task-actions-dropdown')) {
        this.hideTaskDropdown();
      }
    });
  }

  getTaskIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('id');
  }

  async loadTaskDetail() {
    try {
      const response = await fetch(`/api/tasks/${this.taskId}`);
      const result = await response.json();

      if (response.ok && result.success) {
        this.currentTask = result.data;
        this.renderTaskDetail(result.data);

        // Stop log refresh if task is completed
        if (['completed', 'cancelled', 'failed'].includes(result.data.status)) {
          this.stopLogRefresh();
        }
      } else {
        throw new Error(result.error || 'Failed to load task');
      }
    } catch (error) {
      console.error('Error loading task:', error);
      this.showError('Failed to load task details');
    }
  }

  renderTaskDetail(task) {
    console.log('Rendering task detail with data:', task);
    const container = document.getElementById('task-detail-container');

    const createdDate = Utils.formatLocalDateTime(task.created_at);
    const updatedDate = Utils.formatLocalDateTime(task.updated_at);

    const statusBadge = this.getStatusBadge(task.status);
    const stageBadge = this.getStageBadge(task.current_stage);

    const summary = task.summary || task.description.substring(0, 80) + (task.description.length > 80 ? '...' : '');
    const canCancel = task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'failed';
    const canComplete = task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'failed';

    // Update page title with task summary
    document.title = `Duckling - ${summary}`;

    container.innerHTML = `
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
        <!-- Header -->
        <div class="flex justify-between items-start mb-6">
          <div class="flex-1">
            <h1 class="text-2xl font-bold text-gray-900 mb-2">${this.escapeHtml(summary)}</h1>
            <div class="flex items-center space-x-4">
              ${statusBadge}
            </div>
          </div>
          ${(canCancel || canComplete) ? `
            <div class="relative inline-block text-left">
              <button 
                onclick="TaskDetailInstance.toggleTaskDropdown()"
                class="px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-all duration-200 focus:outline-none inline-flex items-center"
                id="task-actions-menu"
              >
                Actions
                <svg class="ml-2 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"></path>
                </svg>
              </button>
              <div 
                id="task-actions-dropdown" 
                class="hidden absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-10"
              >
                <div class="py-1">
                  ${canComplete ? `
                    <button 
                      onclick="TaskDetailInstance.completeTask()"
                      class="block w-full text-left px-4 py-2 text-sm text-green-700 hover:bg-green-50 hover:text-green-800"
                    >
                      <svg class="inline-block w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
                      </svg>
                      Mark as Complete
                    </button>
                  ` : ''}
                  ${canCancel ? `
                    <button 
                      onclick="TaskDetailInstance.cancelTask()"
                      class="block w-full text-left px-4 py-2 text-sm text-red-700 hover:bg-red-50 hover:text-red-800"
                    >
                      <svg class="inline-block w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path>
                      </svg>
                      Cancel Task
                    </button>
                  ` : ''}
                </div>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Task Details -->
        <div class="space-y-6">
          <!-- Description -->
          <div>
            <h3 class="text-lg font-medium text-gray-900 mb-3">Description</h3>
            <div class="bg-gray-50 rounded-lg p-4">
              <p class="text-gray-700 whitespace-pre-wrap">${this.escapeHtml(task.description)}</p>
            </div>
          </div>

          <!-- Details -->
          <div>
            <h3 class="text-lg font-medium text-gray-900 mb-3">Details</h3>
            <div class="space-y-3">
              <div class="flex justify-between">
                <span class="text-gray-600">Task ID:</span>
                <span class="font-mono text-sm">${task.id}</span>
              </div>
              ${this.getRepositoryInfo(task)}
              ${task.coding_tool ? `
                <div class="flex justify-between">
                  <span class="text-gray-600">Coding Tool:</span>
                  <span class="capitalize">${task.coding_tool}</span>
                </div>
              ` : ''}
              ${task.current_stage ? `
                <div class="flex justify-between">
                  <span class="text-gray-600">Stage:</span>
                  <span>${this.getStageBadge(task.current_stage)}</span>
                </div>
              ` : ''}
              ${task.branch_name ? `
                <div class="flex justify-between">
                  <span class="text-gray-600">Branch:</span>
                  ${this.escapeHtml(task.branchName)}
                </div>
              ` : ''}
              ${task.pr_url ? `
                <div class="flex justify-between">
                  <span class="text-gray-600">Pull Request:</span>
                  <a href="${task.pr_url}" target="_blank" class="text-blue-600 hover:text-blue-800 underline">#${task.pr_number}</a>
                </div>
              ` : ''}
              <div class="flex justify-between">
                <span class="text-gray-600">Created:</span>
                <span>${createdDate}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-600">Updated:</span>
                <span>${updatedDate}</span>
              </div>
              ${task.completed_at ? `
                <div class="flex justify-between">
                  <span class="text-gray-600">Completed:</span>
                  <span>${Utils.formatLocalDateTime(task.completed_at)}</span>
                </div>
              ` : ''}
              <div class="flex justify-between pt-2 border-t border-gray-100">
                <span class="text-gray-500 text-sm" id="last-updated">Real-time updates active</span>
                <span class="text-gray-500 text-sm">🔄</span>
              </div>
            </div>
          </div>

          <!-- Logs -->
          <div>
            <h3 class="text-lg font-medium text-gray-900 mb-3">Recent Activity</h3>
            <div id="task-logs" class="bg-gray-900 rounded-lg p-4 max-h-96 overflow-y-auto">
              <div class="text-center py-4">
                <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400 mx-auto mb-2"></div>
                <p class="text-gray-400 text-sm">Loading logs...</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Load logs
    this.loadTaskLogs();
  }

  async loadTaskLogs(incremental = false) {
    try {
      // For incremental loading, only fetch logs after the last loaded ID
      const url = incremental && this.lastLogId > 0
        ? `/api/tasks/${this.taskId}/logs?after=${this.lastLogId}`
        : `/api/tasks/${this.taskId}/logs`;

      const response = await fetch(url);
      const result = await response.json();

      if (response.ok && result.success) {
        if (incremental && this.lastLogId > 0) {
          // Append new logs to existing ones
          this.appendLogs(result.data);
        } else {
          // Full refresh - cache all logs
          this.logs = result.data;
          this.renderLogs(this.logs);
        }

        // Update last log ID
        if (result.data.length > 0) {
          this.lastLogId = Math.max(...result.data.map(log => log.id));
        }
      } else {
        throw new Error(result.error || 'Failed to load logs');
      }
    } catch (error) {
      console.error('Error loading logs:', error);
      if (!incremental) {
        document.getElementById('task-logs').innerHTML = `
          <div class="text-center py-4">
            <p class="text-red-400 text-sm">Failed to load logs</p>
          </div>
        `;
      }
    }
  }

  renderLogs(logs) {
    const container = document.getElementById('task-logs');

    if (logs.length === 0) {
      container.innerHTML = `
        <div class="text-center py-4">
          <p class="text-gray-400 text-sm">No logs yet</p>
        </div>
      `;
      return;
    }

    const logsHTML = logs.map(log => `
      <div class="flex items-start space-x-2 mb-2 text-sm font-mono">
        <span class="text-gray-400">${new Date(log.timestamp).toLocaleTimeString()}</span>
        <span class="text-${this.getLogColor(log.level)}-400 font-medium">[${log.level.toUpperCase()}]</span>
        <span class="text-gray-300 flex-1">${this.escapeHtml(log.message)}</span>
      </div>
    `).join('');

    container.innerHTML = logsHTML;
    this.scrollToBottom(container);
  }

  appendLogs(newLogs) {
    if (newLogs.length === 0) return;

    const container = document.getElementById('task-logs');
    this.logs = [...this.logs, ...newLogs];

    // Only append new logs instead of re-rendering everything
    const newLogsHTML = newLogs.map(log => `
      <div class="flex items-start space-x-2 mb-2 text-sm font-mono">
        <span class="text-gray-400">${new Date(log.timestamp).toLocaleTimeString()}</span>
        <span class="text-${this.getLogColor(log.level)}-400 font-medium">[${log.level.toUpperCase()}]</span>
        <span class="text-gray-300 flex-1">${this.escapeHtml(log.message)}</span>
      </div>
    `).join('');

    container.insertAdjacentHTML('beforeend', newLogsHTML);
    this.scrollToBottom(container);
  }

  scrollToBottom(container) {
    // Auto-scroll to bottom with smooth behavior, but only if user is near bottom
    const isNearBottom = container.scrollTop >= container.scrollHeight - container.clientHeight - 100;
    if (isNearBottom) {
      setTimeout(() => {
        container.scrollTop = container.scrollHeight;
      }, 10);
    }
  }

  startLogRefresh() {
    // Refresh logs every 10 seconds for active tasks using incremental loading
    this.logRefreshInterval = setInterval(() => {
      this.loadTaskLogs(true); // Use incremental loading
    }, 10000);
  }

  stopLogRefresh() {
    if (this.logRefreshInterval) {
      clearInterval(this.logRefreshInterval);
      this.logRefreshInterval = null;
    }
  }

  startEventStream() {
    // Listen for task updates via custom events from the global EventSource
    this.taskUpdateHandler = (event) => {
      const taskUpdate = event.detail;
      console.log('Task detail received SSE update:', taskUpdate);

      if (taskUpdate.taskId == this.taskId) { // Note: == for type coercion
        console.log('Update is for current task, processing...');

        // Use the full task data from metadata if available, otherwise fall back to current task
        if (taskUpdate.metadata && taskUpdate.metadata.task) {
          console.log('Using full task data from metadata:', taskUpdate.metadata.task);
          this.currentTask = taskUpdate.metadata.task;
          this.renderTaskDetail(taskUpdate.metadata.task);

          // Show visual indication of update
          this.showUpdateIndicator();
        } else {
          console.log('No task metadata, falling back to server refresh');
          // Fallback: refresh full task data from server
          this.loadTaskDetail();
        }

        // Stop log refresh if task is completed
        if (['completed', 'cancelled', 'failed'].includes(taskUpdate.status)) {
          console.log('Task completed/cancelled/failed, stopping log refresh');
          this.stopLogRefresh();
        }
      } else {
        console.log(`Update is for different task (${taskUpdate.taskId} vs ${this.taskId}), ignoring`);
      }
    };

    window.addEventListener('duckling-task-update', this.taskUpdateHandler);
    console.log('Listening for task updates via global EventSource');
  }

  stopEventStream() {
    // Remove the event listener
    if (this.taskUpdateHandler) {
      window.removeEventListener('duckling-task-update', this.taskUpdateHandler);
      this.taskUpdateHandler = null;
    }
  }

  getLogColor(level) {
    switch (level) {
      case 'error': return 'red';
      case 'warn': return 'yellow';
      case 'debug': return 'gray';
      default: return 'blue';
    }
  }

  async cancelTask() {
    if (!confirm('Are you sure you want to cancel this task?')) {
      return;
    }

    try {
      const response = await fetch(`/api/tasks/${this.taskId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        this.hideTaskDropdown();
        // Don't reload immediately - let real-time updates handle it
        // The SSE will send a task-update event for the cancelled task
      } else {
        const result = await response.json();
        throw new Error(result.error || 'Failed to cancel task');
      }
    } catch (error) {
      console.error('Error cancelling task:', error);
      alert('Failed to cancel task. Please try again.');
    }
  }

  async completeTask() {
    if (!confirm('Are you sure you want to mark this task as complete?')) {
      return;
    }

    try {
      const response = await fetch(`/api/tasks/${this.taskId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        this.hideTaskDropdown();
        // Don't reload immediately - let real-time updates handle it
        // The SSE will send a task-update event for the completed task
      } else {
        const result = await response.json();
        throw new Error(result.error || 'Failed to complete task');
      }
    } catch (error) {
      console.error('Error completing task:', error);
      alert('Failed to complete task. Please try again.');
    }
  }

  toggleTaskDropdown() {
    const dropdown = document.getElementById('task-actions-dropdown');
    
    if (dropdown) {
      dropdown.classList.toggle('hidden');
    }
  }

  hideTaskDropdown() {
    const dropdown = document.getElementById('task-actions-dropdown');
    if (dropdown) {
      dropdown.classList.add('hidden');
    }
  }

  getStatusBadge(status) {
    return Utils.getStatusBadge(status);
  }

  getStageBadge(stage) {
    return Utils.getStageBadge(stage);
  }

  showError(message) {
    const container = document.getElementById('task-detail-container');
    container.innerHTML = `
      <div class="text-center py-12">
        <div class="text-red-600 mb-4">
          <svg class="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 19c-.77.833.192 2.5 1.732 2.5z"></path>
          </svg>
        </div>
        <h2 class="text-xl font-medium text-gray-900 mb-2">Error</h2>
        <p class="text-gray-600 mb-4">${message}</p>
        <a href="index.html" class="text-gray-600 hover:text-gray-800 underline">← Back to Dashboard</a>
      </div>
    `;
  }

  showUpdateIndicator() {
    // Add a small visual indicator that the page was updated
    const lastUpdated = document.getElementById('last-updated');
    if (lastUpdated) {
      lastUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
      lastUpdated.style.color = '#10b981'; // Green color

      // Reset color after 2 seconds
      setTimeout(() => {
        lastUpdated.style.color = '#6b7280';
      }, 2000);
    }
  }

  escapeHtml(text) {
    return Utils.escapeHtml(text || '');
  }

  async loadRepositories() {
    try {
      const response = await fetch('/api/repositories');
      const result = await response.json();

      if (response.ok) {
        this.repositories = result.data;
      } else {
        console.error('Failed to load repositories:', result.error);
      }
    } catch (error) {
      console.error('Failed to load repositories:', error);
    }
  }

  getRepositoryInfo(task) {
    if (!task.repository_path) return '';

    const repository = this.repositories.find(repo => repo.path === task.repository_path);
    const repositoryDisplay = repository ?
      `${repository.name} <span class="text-gray-500">(${repository.owner})</span>` :
      `<span class="font-mono text-sm">${this.escapeHtml(task.repository_path)}</span>`;

    return `
      <div class="flex justify-between">
        <span class="text-gray-600">Repository:</span>
        <span>${repositoryDisplay}</span>
      </div>
    `;
  }
}

// Initialize task detail when page loads
let TaskDetailInstance;
document.addEventListener('DOMContentLoaded', () => {
  TaskDetailInstance = new TaskDetail();
});
