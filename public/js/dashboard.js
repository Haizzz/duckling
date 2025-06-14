// Dashboard page functionality
class Dashboard {
  constructor() {
    this.loadedTasks = [];
    this.currentPage = 1;
    this.tasksPerPage = 5;
    this.isLoading = false;
    this.hasMore = true;
    this.hasRecentSSEUpdate = false;
    this.isUpdating = false; // Prevent race conditions in updates
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadTasks();
    this.startPolling();
    this.checkRequiredSettings();
  }

  bindEvents() {
    // Task input submission
    const submitBtn = document.getElementById('submit-task');

    submitBtn.addEventListener('click', () => {
      this.createTask();
    });

    // Load more button
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        this.loadMoreTasks();
      });
    }
  }



  async checkRequiredSettings() {
    try {
      const response = await fetch('/api/settings');
      if (response.ok) {
        const result = await response.json();
        const settings = result.data;

        // Check if required settings are present
        const hasGithubToken = settings.githubToken === '***CONFIGURED***';
        const hasApiKey = settings.ampApiKey === '***CONFIGURED***' || settings.openaiApiKey === '***CONFIGURED***';

        const taskInput = document.getElementById('task-input');
        const submitBtn = document.getElementById('submit-task');

        if (!hasGithubToken || !hasApiKey) {
          // Disable task creation
          taskInput.disabled = true;
          taskInput.placeholder = 'Configure GitHub token and API key in settings to create tasks';
          submitBtn.disabled = true;
          submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
        } else {
          // Enable task creation
          taskInput.disabled = false;
          taskInput.placeholder = 'What would you like me to work on?';
          submitBtn.disabled = false;
          submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
      }
    } catch (error) {
      console.error('Failed to check settings:', error);
    }
  }

  async createTask() {
    const taskInput = document.getElementById('task-input');
    const submitBtn = document.getElementById('submit-task');

    // Don't proceed if inputs are disabled
    if (taskInput.disabled || submitBtn.disabled) return;

    const description = taskInput.value.trim();
    if (!description) return;

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description })
      });

      if (response.ok) {
        taskInput.value = '';
        // Reset textarea height and button position

        // Refresh task list to show the new task immediately
        this.refreshTasks();
      } else {
        throw new Error('Failed to create task');
      }
    } catch (error) {
      console.error('Error creating task:', error);
      this.showError('Failed to create task. Please try again.');
    }
  }

  async loadTasks() {
    if (this.isLoading) return;
    this.isLoading = true;

    const loadingEl = document.getElementById('loading-tasks');
    if (this.loadedTasks.length === 0 && loadingEl) {
      loadingEl.classList.remove('hidden');
    }

    try {
      const response = await fetch(`/api/tasks?page=${this.currentPage}&limit=${this.tasksPerPage}`);
      const result = await response.json();

      if (response.ok && result.success) {
        if (this.currentPage === 1) {
          this.loadedTasks = result.data.tasks;
        } else {
          this.loadedTasks.push(...result.data.tasks);
        }

        this.hasMore = result.data.tasks.length === this.tasksPerPage;
        this.renderTasks();
        this.updateLoadMoreButton();
      } else {
        throw new Error(result.error || 'Failed to load tasks');
      }
    } catch (error) {
      console.error('Error loading tasks:', error);
      this.showError('Failed to load tasks');
    } finally {
      this.isLoading = false;
      if (loadingEl) {
        loadingEl.classList.add('hidden');
      }
    }
  }

  async loadMoreTasks() {
    if (!this.hasMore || this.isLoading) return;
    this.currentPage++;
    await this.loadTasks();
  }

  async refreshTasks() {
    // Reset pagination and reload tasks from the beginning
    this.currentPage = 1;
    this.loadedTasks = [];
    this.hasMore = true;
    await this.loadTasks();
  }

  renderTasks() {
    const container = document.getElementById('tasks-container');
    const loadingEl = document.getElementById('loading-tasks');

    if (this.loadedTasks.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12">
          <p class="text-gray-500">No tasks yet. Create your first task above!</p>
        </div>
      `;
      return;
    }

    const tasksHTML = this.loadedTasks.map(task => this.renderTaskCard(task)).join('');
    container.innerHTML = `<div class="space-y-4">${tasksHTML}</div>`;

    if (loadingEl) {
      loadingEl.classList.add('hidden');
    }
  }

  renderTaskCard(task) {
    const createdDate = new Date(task.created_at).toLocaleString();
    const updatedDate = new Date(task.updated_at).toLocaleString();

    const statusBadge = this.getStatusBadge(task.status);

    const prLink = task.pr_url && task.pr_number ?
      `<span class="text-blue-600 text-sm cursor-pointer underline break-words" onclick="window.open('${task.pr_url}', '_blank')">#${task.pr_number}</span>` :
      '<span class="text-gray-400 text-sm">No PR yet</span>';

    const branchName = task.branch_name ?
      `<span class="text-sm text-gray-600 font-mono">${this.escapeHtml(task.branch_name)}</span>` :
      '<span class="text-gray-400 text-sm">No branch yet</span>';

    // Generate a summary from the description (first 80 chars)
    const summary = task.summary || task.description.substring(0, 80) + (task.description.length > 80 ? '...' : '');

    const canCancel = task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'failed';

    return `
      <div class="task-card bg-white border border-gray-200 rounded-lg p-6 hover:shadow-sm transition-shadow" data-task-id="${task.id}">
        <!-- Summary | Status -->
        <div class="flex justify-between items-start mb-4">
          <a href="task-detail.html?id=${task.id}" class="text-lg font-medium text-gray-900 flex-1 mr-4 hover:text-blue-600 hover:underline">${this.escapeHtml(summary)}</a>
          ${statusBadge}
        </div>
        
        <!-- Task Spec -->
        <div class="mb-3">
          <p class="text-sm text-gray-700">${this.escapeHtml(task.description)}</p>
        </div>
        
        
        <!-- Branch Name -->
        <div class="mb-3">
          <div class="flex items-center space-x-2">
            <span class="text-sm font-medium text-gray-600">Branch:</span>
            ${branchName}
          </div>
        </div>
        
        <!-- PR URL -->
        <div class="mb-4">
          <div class="flex items-center space-x-2">
            <span class="text-sm font-medium text-gray-600">Pull Request:</span>
            ${prLink}
          </div>
        </div>
        
        <!-- Created / Updated / Cancel -->
        <div class="flex justify-between items-center pt-3 border-t border-gray-100">
          <div class="flex space-x-4 text-sm text-gray-500">
            <span>Created ${createdDate}</span>
            <span>Updated ${updatedDate}</span>
          </div>
          ${canCancel ? `
            <button 
              onclick="window.Dashboard.cancelTask('${task.id}')"
              class="text-sm text-red-600 hover:text-red-800 hover:underline focus:outline-none"
            >
              Cancel Task
            </button>
          ` : ''}
        </div>
      </div>
    `;
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

  updateLoadMoreButton() {
    const container = document.getElementById('load-more-container');
    const btn = document.getElementById('load-more-btn');

    if (this.hasMore && this.loadedTasks.length >= this.tasksPerPage) {
      container.classList.remove('hidden');
      btn.textContent = this.isLoading ? 'Loading...' : 'Load More';
      btn.disabled = this.isLoading;
    } else {
      container.classList.add('hidden');
    }
  }

  async startPolling() {
    // Get polling interval from server settings for backup polling
    try {
      const response = await fetch('/api/settings/general');
      const result = await response.json();
      let pollInterval = 10; // Default fallback
      
      if (response.ok && result.success) {
        const pollSetting = result.data.find(s => s.key === 'pollInterval');
        if (pollSetting) {
          pollInterval = parseInt(pollSetting.value);
        }
      }
      
      // Use 6x the poll interval for backup polling (less frequent)
      const backupPollMs = pollInterval * 6 * 1000;
      console.log(`Starting backup polling with ${backupPollMs / 1000}s interval`);
      
      setInterval(() => {
        if (!this.isLoading && !this.hasRecentSSEUpdate) {
          // Refresh current tasks without changing page  
          const currentLength = this.loadedTasks.length;
          this.currentPage = Math.ceil(currentLength / this.tasksPerPage) || 1;
          this.loadedTasks = [];
          this.loadTasks();
        }
        // Reset SSE flag
        this.hasRecentSSEUpdate = false;
      }, backupPollMs);
    } catch (error) {
      console.warn('Failed to get poll interval, using default 60s backup polling:', error);
      setInterval(() => {
        if (!this.isLoading && !this.hasRecentSSEUpdate) {
          const currentLength = this.loadedTasks.length;
          this.currentPage = Math.ceil(currentLength / this.tasksPerPage) || 1;
          this.loadedTasks = [];
          this.loadTasks();
        }
        this.hasRecentSSEUpdate = false;
      }, 60000);
    }
  }

  // Handle real-time updates from SSE
  handleTaskUpdate(data) {
    // Prevent race conditions
    if (this.isUpdating) {
      console.log('Update already in progress, skipping...');
      return;
    }
    
    this.isUpdating = true;
    this.hasRecentSSEUpdate = true; // Prevent polling redundancy
    
    try {
      const { taskId, status, metadata } = data;

      // Find and update the task in our loaded tasks
      const taskIndex = this.loadedTasks.findIndex(task => task.id === taskId);
      if (taskIndex >= 0) {
        // Update the task data - prefer full task from metadata if available
        if (metadata && metadata.task) {
          this.loadedTasks[taskIndex] = metadata.task;
        } else {
          this.loadedTasks[taskIndex] = { ...this.loadedTasks[taskIndex], ...metadata, status };
        }
        // Only update the specific task card instead of re-rendering everything
        this.updateTaskCard(taskIndex);
      } else {
        // Task not in current view, might be new - add it to the beginning if on first page
        if (this.currentPage === 1 && metadata) {
          // Add new task to the beginning of the list - prefer full task from metadata
          const newTask = metadata.task || { id: taskId, status, ...metadata };
          this.loadedTasks.unshift(newTask);
          // Re-render the entire task list to show the new task
          this.renderTasks();
        }
      }
    } finally {
      // Always reset the flag
      setTimeout(() => {
        this.isUpdating = false;
      }, 100);
    }
  }

  // Update a specific task card without full re-render
  updateTaskCard(taskIndex) {
    const task = this.loadedTasks[taskIndex];
    // Find the specific task card by data-task-id attribute for better targeting
    const taskCard = document.querySelector(`[data-task-id="${task.id}"]`);
    
    if (taskCard) {
      // Create new card HTML
      const newCardHTML = this.renderTaskCard(task);
      // Create temporary container to parse the HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = newCardHTML;
      const newCard = tempDiv.firstElementChild;
      
      if (newCard) {
        // Replace the existing card with the new one
        taskCard.replaceWith(newCard);
      }
    } else {
      // If we can't find the specific card, fall back to full re-render
      console.warn(`Task card not found for task ${task.id}, doing full re-render`);
      this.renderTasks();
    }
  }

  showError(message) {
    // Simple error display - could be enhanced with a toast system
    console.error(message);
    // You could add a toast notification here
  }

  async cancelTask(taskId) {
    if (!confirm('Are you sure you want to cancel this task?')) {
      return;
    }

    try {
      const response = await fetch(`/api/tasks/${taskId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        // Don't refresh immediately - let real-time updates handle it
        // The SSE will send a task-update event for the cancelled task
      } else {
        const result = await response.json();
        throw new Error(result.error || 'Failed to cancel task');
      }
    } catch (error) {
      console.error('Error cancelling task:', error);
      this.showError('Failed to cancel task. Please try again.');
    }
  }



  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
  window.Dashboard = new Dashboard();
});
