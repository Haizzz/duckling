// Dashboard page functionality
class Dashboard {
  constructor() {
    this.loadedTasks = [];
    this.currentPage = 1;
    this.tasksPerPage = 5;
    this.isLoading = false;
    this.hasMore = true;
    this.hasRecentSSEUpdate = false;
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadTasks();
    this.startPolling();
  }

  bindEvents() {
    // Task input submission
    const taskInput = document.getElementById('task-input');
    const submitBtn = document.getElementById('submit-task');

    submitBtn.addEventListener('click', () => {
      this.createTask();
    });

    taskInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.createTask();
      }
    });

    // Auto-resize textarea and position button with debouncing
    let inputTimeout;
    taskInput.addEventListener('input', () => {
      clearTimeout(inputTimeout);
      inputTimeout = setTimeout(() => {
        this.adjustTextareaAndButton();
      }, 50);
    });

    // Load more button
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        this.loadMoreTasks();
      });
    }

    // Infinite scroll with throttling
    let scrollTimeout;
    window.addEventListener('scroll', () => {
      if (scrollTimeout) return;
      scrollTimeout = setTimeout(() => {
        if (this.isNearBottom() && this.hasMore && !this.isLoading) {
          this.loadMoreTasks();
        }
        scrollTimeout = null;
      }, 100);
    });
  }

  adjustTextareaAndButton() {
    const taskInput = document.getElementById('task-input');
    const submitBtn = document.getElementById('submit-task');

    // Reset height to auto to calculate new height
    taskInput.style.height = 'auto';
    taskInput.style.height = (taskInput.scrollHeight) + 'px';

    // Position button based on content
    const lineCount = (taskInput.value.match(/\n/g) || []).length + 1;
    const hasContent = taskInput.value.trim().length > 0;

    if (lineCount > 1 || taskInput.scrollHeight > 60) {
      // Multiple lines - position at bottom right
      submitBtn.className = "absolute right-2 bottom-2 p-2 text-gray-400 hover:text-gray-600 focus:outline-none border border-gray-300 rounded-lg hover:border-gray-400 transition-all duration-200";
    } else {
      // Single line - position vertically centered
      submitBtn.className = "absolute right-2 top-1/2 transform -translate-y-1/2 p-2 text-gray-400 hover:text-gray-600 focus:outline-none border border-gray-300 rounded-lg hover:border-gray-400 transition-all duration-200";
    }
  }

  isNearBottom() {
    return window.innerHeight + window.scrollY >= document.body.offsetHeight - 1000;
  }

  async createTask() {
    const taskInput = document.getElementById('task-input');
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
        this.adjustTextareaAndButton();
        // Refresh tasks to show the new one
        this.loadedTasks = [];
        this.currentPage = 1;
        this.hasMore = true;
        this.loadTasks();
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
    if (this.loadedTasks.length === 0) {
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
      loadingEl.classList.add('hidden');
    }
  }

  async loadMoreTasks() {
    if (!this.hasMore || this.isLoading) return;
    this.currentPage++;
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

    loadingEl.classList.add('hidden');
  }

  renderTaskCard(task) {
    const createdDate = new Date(task.created_at).toLocaleDateString();
    const updatedDate = new Date(task.updated_at).toLocaleDateString();

    const statusBadge = this.getStatusBadge(task.status);
    const stageBadge = this.getStageBadge(task.current_stage);

    const prLink = task.pr_url ?
      `<a href="${task.pr_url}" target="_blank" class="text-gray-600 hover:text-gray-800 text-sm underline">View PR →</a>` :
      '<span class="text-gray-400 text-sm">No PR yet</span>';

    const branchName = task.branch_name ?
      `<span class="text-sm text-gray-600 font-mono">${this.escapeHtml(task.branch_name)}</span>` :
      '<span class="text-gray-400 text-sm">No branch yet</span>';

    // Generate a summary from the description (first 80 chars)
    const summary = task.summary || task.description.substring(0, 80) + (task.description.length > 80 ? '...' : '');

    const canCancel = task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'failed';

    return `
      <div class="task-card bg-white border border-gray-200 rounded-lg p-6 hover:shadow-sm transition-shadow cursor-pointer" onclick="Dashboard.goToTaskDetail('${task.id}')" data-task-id="${task.id}">
        <!-- Summary | Status -->
        <div class="flex justify-between items-start mb-4">
          <h3 class="text-lg font-medium text-gray-900 flex-1 mr-4">${this.escapeHtml(summary)}</h3>
          ${statusBadge}
        </div>
        
        <!-- Task Spec -->
        <div class="mb-3">
          <p class="text-sm text-gray-700">${this.escapeHtml(task.description)}</p>
        </div>
        
        <!-- Stage -->
        <div class="mb-3">
          <div class="flex items-center space-x-2">
            <span class="text-sm font-medium text-gray-600">Stage:</span>
            ${stageBadge || '<span class="text-gray-400 text-sm">Not started</span>'}
          </div>
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
              onclick="Dashboard.cancelTask('${task.id}')"
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

  startPolling() {
    // Only poll if SSE is not working - prefer real-time updates
    // Poll for task updates every 30 seconds as backup
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
    }, 30000); // Reduced frequency
  }

  // Handle real-time updates from SSE
  handleTaskUpdate(data) {
    this.hasRecentSSEUpdate = true; // Prevent polling redundancy
    const { taskId, status, metadata } = data;
    
    // Find and update the task in our loaded tasks
    const taskIndex = this.loadedTasks.findIndex(task => task.id === taskId);
    if (taskIndex >= 0) {
      // Update the task data
      this.loadedTasks[taskIndex] = { ...this.loadedTasks[taskIndex], ...metadata, status };
      // Only update the specific task card instead of re-rendering everything
      this.updateTaskCard(taskIndex);
    } else {
      // Task not in current view, might be new - only refresh if on first page
      if (this.currentPage === 1) {
        this.loadedTasks = [];
        this.loadTasks();
      }
    }
  }

  // Update a specific task card without full re-render
  updateTaskCard(taskIndex) {
    const task = this.loadedTasks[taskIndex];
    const taskCards = document.querySelectorAll('.task-card');
    if (taskCards[taskIndex]) {
      // Create new card HTML
      const newCardHTML = this.renderTaskCard(task);
      // Replace just this card
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = newCardHTML;
      taskCards[taskIndex].replaceWith(tempDiv.firstElementChild);
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
        // Refresh tasks to show updated status
        this.loadedTasks = [];
        this.currentPage = 1;
        this.hasMore = true;
        this.loadTasks();
      } else {
        const result = await response.json();
        throw new Error(result.error || 'Failed to cancel task');
      }
    } catch (error) {
      console.error('Error cancelling task:', error);
      this.showError('Failed to cancel task. Please try again.');
    }
  }

  goToTaskDetail(taskId) {
    window.location.href = `task-detail.html?id=${taskId}`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
  window.Dashboard = new Dashboard();
});
