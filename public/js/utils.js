// Utility functions
window.Utils = {
  // Debounce function
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  // Escape HTML
  escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  // Format date to local time with user-friendly format
  formatLocalDateTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  },

  // Build query string
  buildQuery(params) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        query.append(key, value);
      }
    }
    return query.toString();
  },

  // Show toast notification
  showToast(message, type = 'info') {
    console.log(
      'showToast called with message:',
      JSON.stringify(message),
      'type:',
      type
    );
    const toast = document.createElement('div');
    toast.className = `fixed top-4 right-4 px-4 py-2 rounded-md shadow-lg z-50 ${
      type === 'success'
        ? 'bg-green-600 text-white'
        : type === 'error'
          ? 'bg-red-600 text-white'
          : type === 'warning'
            ? 'bg-yellow-600 text-white'
            : 'bg-blue-600 text-white'
    }`;
    toast.textContent = message;

    // Add transition styles
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0)';

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  // Check if task is from Jira integration
  isJiraTask(task) {
    return (
      task && task.description && task.description.includes('Jira Ticket: ')
    );
  },

  // Get Jira icon PNG - Using a PNG file for Jira tickets
  getJiraIcon() {
    return `<img src="assets/jira-icon.svg" alt="Jira" class="h-4 w-4 mr-1 flex-shrink-0" />`;
  },

  // Status badge generation (shared across dashboard and task detail)
  getStatusBadge(task) {
    const { status } = task;
    const badges = {
      pending: 'bg-gray-100 text-gray-800',
      'in-progress': 'bg-yellow-100 text-yellow-800',
      'addressing-review': 'bg-yellow-100 text-yellow-800',
      'awaiting-review': 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      cancelled: 'bg-red-100 text-red-800',
    };

    const badgeClass = badges[status] || 'bg-gray-100 text-gray-800';
    const displayStatus = status
      .replace('-', ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());

    // Add Jira icon if task is from Jira
    const jiraIcon = this.isJiraTask(task) ? this.getJiraIcon() : '';

    return `<span class="py-1 flex items-center">${jiraIcon}</span><span class="px-2 py-1 text-xs font-medium rounded-full ${badgeClass} flex items-center">${displayStatus}</span>`;
  },

  // Stage badge generation (shared utility)
  getStageBadge(stage) {
    if (!stage) return '';

    const stageClass = 'bg-gray-50 text-gray-700 border border-gray-200';
    const displayStage = stage
      .replace('_', ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());

    return `<span class="px-2 py-1 text-xs font-medium rounded ${stageClass}">${displayStage}</span>`;
  },

  // Error display helper
  showError(message, containerId = 'error-container') {
    console.error(message);
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = `
        <div class="bg-red-50 border border-red-200 rounded-lg p-4">
          <div class="flex">
            <div class="flex-shrink-0">
              <svg class="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path>
              </svg>
            </div>
            <div class="ml-3">
              <h3 class="text-sm font-medium text-red-800">Error</h3>
              <p class="mt-1 text-sm text-red-700">${this.escapeHtml(message)}</p>
            </div>
          </div>
        </div>
      `;
      container.classList.remove('hidden');
    }
  },

  // Shared task action utilities
  async performTaskAction(taskId, action, options = {}) {
    const { confirmMessage, hideDropdown } = options;

    // Show confirmation if required
    if (confirmMessage && !confirm(confirmMessage)) {
      return;
    }

    try {
      const response = await fetch(`/api/tasks/${taskId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        // Hide dropdown if callback provided
        if (hideDropdown) {
          hideDropdown();
        }

        // Show success toast
        this.showToast(`Task ${action} successful`, 'success');

        return true;
      } else {
        const result = await response.json();
        throw new Error(result.error || `Failed to ${action} task`);
      }
    } catch (error) {
      console.error(`Error ${action} task:`, error);
      this.showToast(`Failed to ${action} task. Please try again.`, 'error');
      return false;
    }
  },

  // Specific task action methods
  async cancelTask(taskId, options = {}) {
    return this.performTaskAction(taskId, 'cancel', {
      confirmMessage: 'Are you sure you want to cancel this task?',
      ...options,
    });
  },

  async completeTask(taskId, options = {}) {
    return this.performTaskAction(taskId, 'complete', {
      confirmMessage: 'Are you sure you want to mark this task as complete?',
      ...options,
    });
  },

  async retryTask(taskId, options = {}) {
    return this.performTaskAction(taskId, 'retry', {
      // No confirmation required as per PR feedback
      ...options,
    });
  },

  async watchTask(taskId, options = {}) {
    return this.performTaskAction(taskId, 'watch', {
      // No confirmation required
      ...options,
    });
  },
};
