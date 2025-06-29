// Dashboard page functionality
class Dashboard {
  constructor() {
    this.loadedTasks = [];
    this.repositories = [];
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
    this.loadRepositories();
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

    // Close dropdowns when clicking outside
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!target.closest('[id^="task-menu-"]') && !target.closest('[id^="task-dropdown-"]')) {
        document.querySelectorAll('[id^="task-dropdown-"]').forEach(dropdown => {
          dropdown.classList.add('hidden');
        });
      }
    });
  }



  async checkRequiredSettings() {
    try {
      const response = await fetch('/api/settings');
      if (response.ok) {
        const result = await response.json();
        const settings = result.data;

        // Check if required settings are present
        const hasGithubToken = settings.githubToken === '***CONFIGURED***';
        const hasGithubUsername = settings.githubUsername;
        const hasAmpTool = settings.ampApiKey === '***CONFIGURED***';
        const hasOpenAiTool = settings.openaiApiKey === '***CONFIGURED***';
        const hasOpenAiForCommits = settings.openaiApiKey === '***CONFIGURED***'; // Required for both tools

        // Determine what's missing
        const missingRequirements = [];

        if (!hasGithubToken) missingRequirements.push('GitHub token');
        if (!hasGithubUsername) missingRequirements.push('GitHub username');
        if (!hasOpenAiForCommits) missingRequirements.push('OpenAI API key');
        if (!hasAmpTool && !hasOpenAiTool) missingRequirements.push('at least one coding tool (Amp or OpenAI)');

        if (missingRequirements.length > 0) {
          // Mark settings as missing and update form state
          const missingText = missingRequirements.join(', ');
          this.setTaskFormEnabled(false, `Missing configuration: ${missingText}. Visit settings to configure.`);

          // Show a helper message
          this.showConfigurationHelper(missingRequirements);
        } else {
          // Clear missing settings flag and update form state
          this.setTaskFormEnabled(true);

          // Hide helper message if it exists
          this.hideConfigurationHelper();
        }

        // Always update form state to consider both repositories and settings
        this.updateTaskFormState();
      }
    } catch (error) {
      console.error('Failed to check settings:', error);
    }
  }

  showConfigurationHelper(missingRequirements) {
    let helperEl = document.getElementById('config-helper');
    if (!helperEl) {
      // Create the helper element
      helperEl = document.createElement('div');
      helperEl.id = 'config-helper';
      helperEl.className = 'bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 max-w-2xl mx-auto';

      const taskInputContainer = document.querySelector('.max-w-2xl.mx-auto');
      taskInputContainer.parentNode.insertBefore(helperEl, taskInputContainer);
    }

    const toolsText = missingRequirements.includes('at least one coding tool (Amp or OpenAI)')
      ? '<li><strong>Coding Tool:</strong> Configure either Amp (requires Amp token) or OpenAI (requires OpenAI key)</li>'
      : '';

    const githubText = missingRequirements.includes('GitHub token')
      ? '<li><strong>GitHub Token:</strong> Create a personal access token with repo permissions</li>'
      : '';

    const usernameText = missingRequirements.includes('GitHub username')
      ? '<li><strong>GitHub Username:</strong> Your GitHub username for PR comment filtering</li>'
      : '';

    const openaiText = missingRequirements.includes('OpenAI API key')
      ? '<li><strong>OpenAI API Key:</strong> Required for commit messages and task summaries</li>'
      : '';

    helperEl.innerHTML = `
      <div class="flex items-start">
        <div class="flex-shrink-0">
          <svg class="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
          </svg>
        </div>
        <div class="ml-3">
          <h3 class="text-sm font-medium text-yellow-800">Configuration Required</h3>
          <div class="mt-2 text-sm text-yellow-700">
            <p class="mb-2">Before creating tasks, you need to configure:</p>
            <ul class="list-disc list-inside space-y-1">
              ${githubText}${usernameText}${openaiText}${toolsText}
            </ul>
            <p class="mt-3">
              <a href="settings.html" class="font-medium underline hover:no-underline">
                Go to Settings →
              </a>
            </p>
          </div>
        </div>
      </div>
    `;

    helperEl.classList.remove('hidden');
  }

  hideConfigurationHelper() {
    const helperEl = document.getElementById('config-helper');
    if (helperEl) {
      helperEl.classList.add('hidden');
    }
  }

  async createTask() {
    const taskInput = document.getElementById('task-input');
    const repositorySelect = document.getElementById('repository-select');
    const submitBtn = document.getElementById('submit-task');

    // Don't proceed if inputs are disabled
    if (taskInput.disabled || submitBtn.disabled) return;

    const description = taskInput.value.trim();
    const repositoryPath = repositorySelect.value;

    if (!description) return;
    if (!repositoryPath) {
      Utils.showToast('Please select a repository', 'error');
      return;
    }

    // Store original icon and show spinner
    const originalIcon = submitBtn.innerHTML;
    submitBtn.innerHTML = `
      <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    `;
    submitBtn.disabled = true;

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, repositoryPath })
      });

      if (response.ok) {
        taskInput.value = '';
        // Reset textarea height and button position

        // Refresh task list to show the new task immediately
        this.refreshTasks();
      } else {
        const result = await response.json();
        throw new Error(result.error || 'Failed to create task');
      }
    } catch (error) {
      console.error('Error creating task:', error);
      this.showError(error.message || 'Failed to create task. Please try again.');
    } finally {
      // Restore original icon and re-enable button
      submitBtn.innerHTML = originalIcon;
      submitBtn.disabled = false;
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

        // Use pagination info to determine if there are more tasks
        const pagination = result.data.pagination;
        this.hasMore = pagination ? this.currentPage < pagination.totalPages : result.data.tasks.length === this.tasksPerPage;
        this.renderTasks();
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
      this.updateLoadMoreButton();
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
    const createdDate = Utils.formatLocalDateTime(task.created_at);
    const updatedDate = Utils.formatLocalDateTime(task.updated_at);

    const statusBadge = this.getStatusBadge(task.status);

    const prLink = task.pr_url && task.pr_number ?
      `<span class="text-blue-600 text-sm cursor-pointer underline break-words" onclick="window.open('${task.pr_url}', '_blank')">#${task.pr_number}</span>` :
      '<span class="text-gray-400 text-sm">No PR yet</span>';

    const branchName = task.branch_name ?
      `<span class="text-sm text-gray-600 font-mono">${this.escapeHtml(task.branch_name)}</span>` :
      '<span class="text-gray-400 text-sm">No branch yet</span>';

    // Get repository info
    const repository = this.repositories.find(repo => repo.path === task.repository_path);
    const repositoryInfo = repository ?
      `<span class="text-sm text-gray-600">${repository.name}</span>` :
      `<span class="text-sm text-gray-500 font-mono">${this.escapeHtml(task.repository_path || 'Unknown')}</span>`;

    // Generate a summary from the description (first 80 chars)
    const summary = task.summary || task.description.substring(0, 80) + (task.description.length > 80 ? '...' : '');

    const canCancel = task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'failed';
    const canComplete = task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'failed';

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
        
        
        <!-- Repository and Branch -->
        <div class="mb-3 space-y-2">
          <div class="flex items-center space-x-2">
            <span class="text-sm font-medium text-gray-600">Repository:</span>
            ${repositoryInfo}
          </div>
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
        
        <!-- Created / Updated / Actions -->
        <div class="flex justify-between items-center pt-3 border-t border-gray-100">
          <div class="flex space-x-4 text-sm text-gray-500">
            <span>Created ${createdDate}</span>
            <span>Updated ${updatedDate}</span>
          </div>
          ${(canCancel || canComplete) ? `
            <div class="relative inline-block text-left">
              <button 
                onclick="window.Dashboard.toggleTaskDropdown('${task.id}')"
                class="text-sm text-gray-600 hover:text-gray-800 focus:outline-none inline-flex items-center"
                id="task-menu-${task.id}"
              >
                Actions
                <svg class="ml-1 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"></path>
                </svg>
              </button>
              <div 
                id="task-dropdown-${task.id}" 
                class="hidden absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-10"
              >
                <div class="py-1">
                  ${canComplete ? `
                    <button 
                      onclick="window.Dashboard.completeTask('${task.id}')"
                      class="block w-full text-left px-4 py-2 text-sm text-green-700 hover:bg-green-50 hover:text-green-800"
                    >
                      Mark as Complete
                    </button>
                  ` : ''}
                  ${canCancel ? `
                    <button 
                      onclick="window.Dashboard.cancelTask('${task.id}')"
                      class="block w-full text-left px-4 py-2 text-sm text-red-700 hover:bg-red-50 hover:text-red-800"
                    >
                      Cancel Task
                    </button>
                  ` : ''}
                </div>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  getStatusBadge(status) {
    return Utils.getStatusBadge(status);
  }

  getStageBadge(stage) {
    return Utils.getStageBadge(stage);
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
    Utils.showToast(message, 'error');
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
        this.hideTaskDropdown(taskId);
      } else {
        const result = await response.json();
        throw new Error(result.error || 'Failed to cancel task');
      }
    } catch (error) {
      console.error('Error cancelling task:', error);
      this.showError('Failed to cancel task. Please try again.');
    }
  }

  async completeTask(taskId) {
    if (!confirm('Are you sure you want to mark this task as complete?')) {
      return;
    }

    try {
      const response = await fetch(`/api/tasks/${taskId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        // Don't refresh immediately - let real-time updates handle it
        // The SSE will send a task-update event for the completed task
        this.hideTaskDropdown(taskId);
      } else {
        const result = await response.json();
        throw new Error(result.error || 'Failed to complete task');
      }
    } catch (error) {
      console.error('Error completing task:', error);
      this.showError('Failed to complete task. Please try again.');
    }
  }

  toggleTaskDropdown(taskId) {
    const dropdown = document.getElementById(`task-dropdown-${taskId}`);
    
    // Hide all other dropdowns first
    document.querySelectorAll('[id^="task-dropdown-"]').forEach(el => {
      if (el.id !== `task-dropdown-${taskId}`) {
        el.classList.add('hidden');
      }
    });

    // Toggle current dropdown
    if (dropdown) {
      dropdown.classList.toggle('hidden');
    }
  }

  hideTaskDropdown(taskId) {
    const dropdown = document.getElementById(`task-dropdown-${taskId}`);
    if (dropdown) {
      dropdown.classList.add('hidden');
    }
  }



  escapeHtml(text) {
    return Utils.escapeHtml(text || '');
  }

  // Helper method to enable/disable task creation form
  // Checks both repository availability and required settings
  updateTaskFormState() {
    const taskInput = document.getElementById('task-input');
    const submitBtn = document.getElementById('submit-task');

    // Check if we have repositories
    const hasRepositories = this.repositories.length > 0;

    // Check if we have required settings (simplified check here)
    // We'll call this from checkRequiredSettings with the actual settings
    const hasRequiredSettings = !taskInput.hasAttribute('data-missing-settings');

    if (!hasRepositories) {
      // No repositories takes priority
      taskInput.disabled = true;
      taskInput.placeholder = 'Add repositories in settings before creating tasks';
      submitBtn.disabled = true;
      submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
    } else if (!hasRequiredSettings) {
      // Has repositories but missing settings
      taskInput.disabled = true;
      // Placeholder will be set by checkRequiredSettings
      submitBtn.disabled = true;
      submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
      // All good - enable form
      taskInput.disabled = false;
      taskInput.placeholder = 'What would you like me to work on?';
      submitBtn.disabled = false;
      submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }

  // Legacy helper for backward compatibility
  setTaskFormEnabled(enabled, placeholderText = null) {
    const taskInput = document.getElementById('task-input');
    const submitBtn = document.getElementById('submit-task');

    if (enabled) {
      taskInput.disabled = false;
      taskInput.placeholder = placeholderText || 'What would you like me to work on?';
      submitBtn.disabled = false;
      submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      taskInput.removeAttribute('data-missing-settings');
    } else {
      taskInput.disabled = true;
      taskInput.placeholder = placeholderText || 'Task creation disabled';
      submitBtn.disabled = true;
      submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
      if (placeholderText && placeholderText.includes('Missing configuration')) {
        taskInput.setAttribute('data-missing-settings', 'true');
      }
    }
  }

  async loadRepositories() {
    try {
      const response = await fetch('/api/repositories');
      const result = await response.json();

      if (response.ok) {
        this.repositories = result.data;
        this.updateRepositoryUI();
      } else {
        console.error('Failed to load repositories:', result.error);
        this.updateRepositoryUI(); // Show no repos warning
      }
    } catch (error) {
      console.error('Failed to load repositories:', error);
      this.updateRepositoryUI(); // Show no repos warning
    }
  }

  updateRepositoryUI() {
    const repositoryPill = document.getElementById('repository-pill');
    const repositorySelect = document.getElementById('repository-select');
    const noReposWarning = document.getElementById('no-repos-task-warning');
    const submitBtn = document.getElementById('submit-task');

    if (this.repositories.length === 0) {
      // No repositories - show warning, hide pill
      repositoryPill.classList.add('hidden');
      noReposWarning.classList.remove('hidden');
    } else {
      // Has repositories - show pill, hide warning
      repositoryPill.classList.remove('hidden');
      noReposWarning.classList.add('hidden');

      // Populate repository dropdown with name only when closed, name + path when open
      repositorySelect.innerHTML = this.repositories.map(repo => `
        <option value="${repo.path}">${repo.name} (${repo.path})</option>
      `).join('');

      // Set first repository as default (always have a selection)
      if (this.repositories.length > 0) {
        repositorySelect.value = this.repositories[0].path;
        submitBtn.disabled = false;
      }
    }

    // Update form state based on both repositories and settings
    this.updateTaskFormState();
  }
}

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
  window.Dashboard = new Dashboard();
});
