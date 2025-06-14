// Task detail page functionality
class TaskDetail {
  constructor() {
    this.taskId = this.getTaskIdFromUrl();
    this.logRefreshInterval = null;
    this.currentTask = null;
    this.taskUpdateHandler = null;
    this.lastLogId = 0; // Track last loaded log ID for incremental loading
    this.logs = []; // Cache logs to avoid full re-render

    if (this.taskId) {
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
    const container = document.getElementById('task-detail-container');

    const createdDate = new Date(task.created_at).toLocaleString();
    const updatedDate = new Date(task.updated_at).toLocaleString();

    const statusBadge = this.getStatusBadge(task.status);
    const stageBadge = this.getStageBadge(task.current_stage);

    const summary = task.summary || task.description.substring(0, 80) + (task.description.length > 80 ? '...' : '');
    const canCancel = task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'failed';

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
          ${canCancel ? `
            <button 
              onclick="TaskDetailInstance.cancelTask()"
              class="px-4 py-2 border border-red-300 text-red-600 rounded hover:bg-red-600 hover:text-white hover:border-red-600 transition-all duration-200 focus:outline-none"
            >
              Cancel Task
            </button>
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
              ${task.current_stage ? `
                <div class="flex justify-between">
                  <span class="text-gray-600">Stage:</span>
                  <span>${this.getStageBadge(task.current_stage)}</span>
                </div>
              ` : ''}
              ${task.branch_name ? `
                <div class="flex justify-between">
                  <span class="text-gray-600">Branch:</span>
                  ${this.getBranchLink(task.branch_name)}
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
                  <span>${new Date(task.completed_at).toLocaleString()}</span>
                </div>
              ` : ''}
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
      if (taskUpdate.taskId == this.taskId) { // Note: == for type coercion
        // Use the full task data from metadata if available, otherwise fall back to current task
        if (taskUpdate.metadata && taskUpdate.metadata.task) {
          this.currentTask = taskUpdate.metadata.task;
          this.renderTaskDetail(taskUpdate.metadata.task);
        } else {
          // Fallback: refresh full task data from server
          this.loadTaskDetail();
        }

        // Stop log refresh if task is completed
        if (['completed', 'cancelled', 'failed'].includes(taskUpdate.status)) {
          this.stopLogRefresh();
        }
      }
    };

    window.addEventListener('intern-task-update', this.taskUpdateHandler);
    console.log('Listening for task updates via global EventSource');
  }

  stopEventStream() {
    // Remove the event listener
    if (this.taskUpdateHandler) {
      window.removeEventListener('intern-task-update', this.taskUpdateHandler);
      this.taskUpdateHandler = null;
    }
  }

  getBranchLink(branchName) {
    return `<a href="javascript:void(0)" onclick="TaskDetailInstance.openBranchUrl('${this.escapeHtml(branchName)}')" class="font-mono text-sm text-blue-600 hover:text-blue-800 underline">${this.escapeHtml(branchName)}</a>`;
  }

  async openBranchUrl(branchName) {
    try {
      // Get repo info from server
      const response = await fetch('/api/repo-info');
      if (response.ok) {
        const result = await response.json();
        const repoUrl = `https://github.com/${result.owner}/${result.name}/tree/${encodeURIComponent(branchName)}`;
        window.open(repoUrl, '_blank');
      } else {
        // Fallback - just copy branch name to clipboard or show error
        navigator.clipboard.writeText(branchName);
        alert('Copied branch name to clipboard');
      }
    } catch (error) {
      navigator.clipboard.writeText(branchName);
      alert('Copied branch name to clipboard');
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
        // Reload the page to show updated status
        window.location.reload();
      } else {
        const result = await response.json();
        throw new Error(result.error || 'Failed to cancel task');
      }
    } catch (error) {
      console.error('Error cancelling task:', error);
      alert('Failed to cancel task. Please try again.');
    }
  }

  getStatusBadge(status) {
    const badges = {
      'pending': 'bg-gray-100 text-gray-800',
      'in-progress': 'bg-yellow-100 text-yellow-800',
      'awaiting-review': 'bg-blue-100 text-blue-800',
      'completed': 'bg-green-100 text-green-800',
      'failed': 'bg-red-100 text-red-800',
      'cancelled': 'bg-red-100 text-red-800'
    };

    const badgeClass = badges[status] || 'bg-gray-100 text-gray-800';
    const displayStatus = status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase());

    return `<span class="px-2 py-1 text-xs font-medium rounded-full ${badgeClass}">${displayStatus}</span>`;
  }

  getStageBadge(stage) {
    if (!stage) return '';

    const stageClass = 'bg-gray-50 text-gray-700 border border-gray-200';
    const displayStage = stage.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

    return `<span class="px-2 py-1 text-xs font-medium rounded ${stageClass}">${displayStage}</span>`;
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

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize task detail when page loads
let TaskDetailInstance;
document.addEventListener('DOMContentLoaded', () => {
  TaskDetailInstance = new TaskDetail();
});
