// Reusable UI components
window.Components = {
  
  // Task card component
  createTaskCard(task) {
    const timeAgo = Utils.formatRelativeTime(task.updated_at);
    const statusFormatted = Utils.formatStatus(task.status);
    
    return `
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow cursor-pointer" 
           data-task-id="${task.id}" onclick="window.location.href='/task-detail.html?id=${task.id}'">
        <!-- Header -->
        <div class="flex items-start justify-between mb-4">
          <div class="flex-1">
            <h3 class="text-lg font-medium text-gray-900 mb-1">${Utils.escapeHtml(task.title)}</h3>
            <p class="text-sm text-gray-600 line-clamp-2">${Utils.escapeHtml(task.description.substring(0, 150))}${task.description.length > 150 ? '...' : ''}</p>
          </div>
          <div class="flex items-center space-x-2 ml-4">
            <span class="status-badge status-${task.status}">${statusFormatted}</span>
            <div class="relative">
              <button class="text-gray-400 hover:text-gray-600" onclick="Components.toggleTaskMenu(event, '${task.id}')">
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Metadata Grid -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
          <div>
            <span class="text-gray-500">Agent:</span>
            <span class="ml-1 font-medium">${Utils.escapeHtml(task.coding_tool)}</span>
          </div>
          ${task.branch_name ? `
          <div>
            <span class="text-gray-500">Branch:</span>
            <span class="ml-1 font-mono text-xs">${Utils.escapeHtml(task.branch_name)}</span>
          </div>
          ` : '<div></div>'}
          ${task.pr_url ? `
          <div>
            <span class="text-gray-500">PR:</span>
            <a href="${task.pr_url}" class="ml-1 text-blue-600 hover:text-blue-800" onclick="event.stopPropagation()" target="_blank">
              #${task.pr_number}
            </a>
          </div>
          ` : '<div></div>'}
          <div>
            <span class="text-gray-500">Updated:</span>
            <span class="ml-1">${timeAgo}</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center justify-between pt-2 border-t border-gray-100">
          <div class="flex items-center space-x-4 text-sm text-gray-500">
            <span>Created ${Utils.formatRelativeTime(task.created_at)}</span>
          </div>
          <div class="flex items-center space-x-2">
            <button class="text-blue-600 hover:text-blue-800 text-sm font-medium" onclick="event.stopPropagation(); window.location.href='/task-detail.html?id=${task.id}#logs'">
              View Logs
            </button>
            ${task.status === 'failed' ? `
            <button class="text-green-600 hover:text-green-800 text-sm font-medium" onclick="Components.retryTask(event, '${task.id}')">
              Retry
            </button>
            ` : ''}
            ${task.status !== 'completed' && task.status !== 'cancelled' ? `
            <button class="text-red-600 hover:text-red-800 text-sm font-medium" onclick="Components.cancelTask(event, '${task.id}')">
              Cancel
            </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  },

  // Log entry component
  createLogEntry(log) {
    const timestamp = new Date(log.timestamp).toLocaleTimeString();
    const levelColor = {
      'info': 'text-blue-400',
      'error': 'text-red-400',
      'debug': 'text-gray-400'
    }[log.level] || 'text-gray-400';
    
    return `
      <div class="log-entry" data-level="${log.level}" data-timestamp="${log.timestamp}">
        <span class="text-gray-500">[${timestamp}]</span>
        <span class="${levelColor}">[${log.level.toUpperCase()}]</span>
        <span class="text-gray-100">${Utils.escapeHtml(log.message)}</span>
      </div>
    `;
  },

  // Pagination component
  createPagination(currentPage, totalPages, onPageChange) {
    if (totalPages <= 1) return '';
    
    let pages = [];
    
    // Always show first page
    pages.push(1);
    
    // Show pages around current page
    const start = Math.max(2, currentPage - 2);
    const end = Math.min(totalPages - 1, currentPage + 2);
    
    if (start > 2) pages.push('...');
    
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    
    if (end < totalPages - 1) pages.push('...');
    
    // Always show last page if more than 1
    if (totalPages > 1) pages.push(totalPages);
    
    const pageButtons = pages.map(page => {
      if (page === '...') {
        return '<span class="px-3 py-2 text-gray-500">...</span>';
      }
      
      const isActive = page === currentPage;
      return `
        <button class="px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50 ${
          isActive ? 'bg-blue-600 text-white border-blue-600' : ''
        }" onclick="${onPageChange}(${page})">
          ${page}
        </button>
      `;
    }).join('');
    
    return `
      <div class="flex items-center space-x-1">
        <button class="px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50 ${
          currentPage === 1 ? 'opacity-50 cursor-not-allowed' : ''
        }" onclick="${onPageChange}(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>
          Previous
        </button>
        ${pageButtons}
        <button class="px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50 ${
          currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : ''
        }" onclick="${onPageChange}(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>
          Next
        </button>
      </div>
    `;
  },

  // Task actions
  async retryTask(event, taskId) {
    event.stopPropagation();
    event.preventDefault();
    
    try {
      await API.retryTask(taskId);
      Utils.showToast('Task retry initiated', 'success');
      location.reload();
    } catch (error) {
      Utils.showToast(`Failed to retry task: ${error.message}`, 'error');
    }
  },

  async cancelTask(event, taskId) {
    event.stopPropagation();
    event.preventDefault();
    
    if (!confirm('Are you sure you want to cancel this task?')) {
      return;
    }
    
    try {
      await API.cancelTask(taskId);
      Utils.showToast('Task cancelled', 'success');
      location.reload();
    } catch (error) {
      Utils.showToast(`Failed to cancel task: ${error.message}`, 'error');
    }
  },

  toggleTaskMenu(event, taskId) {
    event.stopPropagation();
    event.preventDefault();
    // Task menu functionality can be added here
  },

  // Loading spinner
  createLoadingSpinner(text = 'Loading...') {
    return `
      <div class="flex items-center justify-center py-12">
        <div class="text-center">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p class="text-gray-600">${text}</p>
        </div>
      </div>
    `;
  },

  // Empty state
  createEmptyState(title, description, actionText, actionOnClick) {
    return `
      <div class="text-center py-12">
        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <h3 class="mt-4 text-lg font-medium text-gray-900">${title}</h3>
        <p class="mt-2 text-gray-500">${description}</p>
        ${actionText ? `
        <button class="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700" onclick="${actionOnClick}">
          ${actionText}
        </button>
        ` : ''}
      </div>
    `;
  }
};
