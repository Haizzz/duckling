// Page components and handlers
window.Pages = {
  
  // Dashboard page
  async renderDashboard() {
    const container = document.getElementById('app');
    
    container.innerHTML = `
      <!-- Navigation Header -->
      <nav class="bg-white shadow-sm border-b">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex justify-between items-center h-16">
            <div class="flex items-center">
              <h1 class="text-xl font-semibold text-gray-900">Intern</h1>
            </div>
            <div class="flex items-center space-x-4">
              <button id="new-task-btn" class="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700" onclick="App.navigate('/task/new')">
                New Task
              </button>
              <button onclick="App.navigate('/settings')" class="text-gray-500 hover:text-gray-700">
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <!-- Main Content -->
      <main class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <!-- Filters & Search -->
        <div class="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between">
          <div class="flex space-x-2 mb-4 sm:mb-0">
            <button class="filter-btn active" data-status="all" onclick="Pages.filterTasks('all', this)">All</button>
            <button class="filter-btn" data-status="pending" onclick="Pages.filterTasks('pending', this)">Pending</button>
            <button class="filter-btn" data-status="in_progress" onclick="Pages.filterTasks('in_progress', this)">In Progress</button>
            <button class="filter-btn" data-status="awaiting_review" onclick="Pages.filterTasks('awaiting_review', this)">Awaiting Review</button>
            <button class="filter-btn" data-status="completed" onclick="Pages.filterTasks('completed', this)">Completed</button>
            <button class="filter-btn" data-status="failed" onclick="Pages.filterTasks('failed', this)">Failed</button>
          </div>
          
          <div class="flex items-center space-x-4">
            <input type="text" id="search-input" placeholder="Search tasks..." 
                   class="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
            <select id="sort-select" class="px-3 py-2 border border-gray-300 rounded-md" onchange="Pages.sortTasks()">
              <option value="created_desc">Newest First</option>
              <option value="created_asc">Oldest First</option>
              <option value="updated_desc">Recently Updated</option>
              <option value="title_asc">Title A-Z</option>
            </select>
          </div>
        </div>

        <!-- Task List -->
        <div id="task-list" class="space-y-4">
          ${Components.createLoadingSpinner('Loading tasks...')}
        </div>

        <!-- Pagination -->
        <div id="pagination" class="mt-8 flex items-center justify-between">
          <!-- Populated by loadTasks -->
        </div>
      </main>
    `;

    // Set up search debouncing
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', Utils.debounce(() => {
      this.loadTasks();
    }, 300));

    // Load initial tasks
    await this.loadTasks();
  },

  currentFilters: {
    status: 'all',
    page: 1,
    limit: 10,
    search: '',
    sort: 'created_desc'
  },

  async loadTasks() {
    const taskList = document.getElementById('task-list');
    const pagination = document.getElementById('pagination');
    
    try {
      const filters = { ...this.currentFilters };
      if (filters.status === 'all') delete filters.status;
      if (!filters.search) delete filters.search;

      const result = await API.getTasks(filters);
      const { tasks, pagination: paginationData } = result;

      if (tasks.length === 0) {
        taskList.innerHTML = Components.createEmptyState(
          'No tasks found',
          'Create your first automated coding task to get started.',
          'Create Task',
          "App.navigate('/task/new')"
        );
      } else {
        taskList.innerHTML = tasks.map(task => Components.createTaskCard(task)).join('');
      }

      // Update pagination
      if (paginationData && paginationData.totalPages > 1) {
        pagination.innerHTML = `
          <div class="text-sm text-gray-700">
            Showing ${(paginationData.page - 1) * paginationData.limit + 1} to ${Math.min(paginationData.page * paginationData.limit, paginationData.total)} of ${paginationData.total} tasks
          </div>
          ${Components.createPagination(paginationData.page, paginationData.totalPages, 'Pages.changePage')}
        `;
      } else {
        pagination.innerHTML = '';
      }

    } catch (error) {
      taskList.innerHTML = `
        <div class="text-center py-12">
          <p class="text-red-600">Failed to load tasks: ${error.message}</p>
          <button class="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700" onclick="Pages.loadTasks()">
            Retry
          </button>
        </div>
      `;
    }
  },

  filterTasks(status, button) {
    // Update active filter button
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    
    this.currentFilters.status = status;
    this.currentFilters.page = 1;
    this.loadTasks();
  },

  sortTasks() {
    const sortSelect = document.getElementById('sort-select');
    this.currentFilters.sort = sortSelect.value;
    this.currentFilters.page = 1;
    this.loadTasks();
  },

  changePage(page) {
    this.currentFilters.page = page;
    this.loadTasks();
  },

  // Onboarding page
  async renderOnboarding() {
    const container = document.getElementById('app');
    
    container.innerHTML = `
      <div class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center py-12 px-4">
        <div class="max-w-2xl w-full">
          <div class="text-center mb-8">
            <h1 class="text-4xl font-bold text-gray-900 mb-4">Welcome to Intern</h1>
            <p class="text-xl text-gray-600">Let's get you set up with automated code review</p>
          </div>

          <div class="bg-white rounded-lg shadow-lg p-8">
            <!-- Progress Steps -->
            <div class="mb-8">
              <div class="flex items-center justify-between mb-4">
                <div class="step active" data-step="1">
                  <div class="step-circle">1</div>
                  <span class="step-label">API Keys</span>
                </div>
                <div class="step-line"></div>
                <div class="step" data-step="2">
                  <div class="step-circle">2</div>
                  <span class="step-label">GitHub</span>
                </div>
                <div class="step-line"></div>
                <div class="step" data-step="3">
                  <div class="step-circle">3</div>
                  <span class="step-label">Preferences</span>
                </div>
              </div>
              <div class="progress-bar">
                <div class="progress-fill" id="progress-fill" style="width: 33%"></div>
              </div>
            </div>

            <!-- Step Content -->
            <div id="onboarding-content">
              ${this.renderOnboardingStep1()}
            </div>

            <!-- Navigation -->
            <div class="flex justify-between mt-8 pt-6 border-t border-gray-200">
              <button id="prev-btn" class="px-6 py-2 text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50" onclick="Pages.onboardingPrev()" disabled>
                Previous
              </button>
              <button id="next-btn" class="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700" onclick="Pages.onboardingNext()">
                Next
              </button>
              <button id="finish-btn" class="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 hidden" onclick="Pages.completeOnboarding()">
                Complete Setup
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  currentOnboardingStep: 1,
  onboardingData: {},

  renderOnboardingStep1() {
    return `
      <div id="step-1" class="step-content">
        <h2 class="text-2xl font-semibold text-gray-900 mb-4">Configure API Keys</h2>
        <p class="text-gray-600 mb-6">Add your API keys to enable coding assistants</p>
        
        <div class="space-y-4">
          <div>
            <label for="github-token" class="block text-sm font-medium text-gray-700 mb-2">
              GitHub Token * <span class="text-xs text-gray-500">(Required for PR management)</span>
            </label>
            <input type="password" id="github-token" required
                   class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                   placeholder="ghp_xxxxxxxxxxxx">
            <p class="text-xs text-gray-500 mt-1">
              <a href="https://github.com/settings/personal-access-tokens" target="_blank" class="text-blue-600 hover:text-blue-800">
                Generate a GitHub token →
              </a>
            </p>
          </div>

          <div>
            <label for="coding-tool-choice" class="block text-sm font-medium text-gray-700 mb-2">
              Choose a coding assistant *
            </label>
            <select id="coding-tool-choice" required onchange="Pages.toggleApiKeyInput()"
                    class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select a tool...</option>
              <option value="amp">Amp</option>
              <option value="openai">OpenAI Codex</option>
              <option value="claude">Claude Code</option>
            </select>
          </div>

          <div id="api-key-input" class="hidden">
            <label for="selected-api-key" class="block text-sm font-medium text-gray-700 mb-2">
              <span id="api-key-label">API Key</span> *
            </label>
            <input type="password" id="selected-api-key" 
                   class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                   placeholder="">
          </div>
        </div>
      </div>
    `;
  },

  renderOnboardingStep2() {
    return `
      <div id="step-2" class="step-content">
        <h2 class="text-2xl font-semibold text-gray-900 mb-4">GitHub Configuration</h2>
        <p class="text-gray-600 mb-6">Configure your GitHub repository and user settings</p>
        
        <div class="space-y-4">
          <div>
            <label for="github-repo" class="block text-sm font-medium text-gray-700 mb-2">
              Repository URL *
            </label>
            <input type="url" id="github-repo" required
                   class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                   placeholder="https://github.com/username/repository">
          </div>

          <div>
            <label for="github-username" class="block text-sm font-medium text-gray-700 mb-2">
              Your GitHub Username *
            </label>
            <input type="text" id="github-username" required
                   class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                   placeholder="username">
            <p class="text-xs text-gray-500 mt-1">Intern will only respond to PR comments from this user</p>
          </div>

          <div>
            <label for="poll-interval" class="block text-sm font-medium text-gray-700 mb-2">
              PR Comment Polling Interval (seconds)
            </label>
            <input type="number" id="poll-interval" value="30" min="10" max="300"
                   class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
        </div>
      </div>
    `;
  },

  renderOnboardingStep3() {
    return `
      <div id="step-3" class="step-content">
        <h2 class="text-2xl font-semibold text-gray-900 mb-4">Preferences</h2>
        <p class="text-gray-600 mb-6">Customize Intern's behavior</p>
        
        <div class="space-y-4">
          <div>
            <label for="branch-prefix" class="block text-sm font-medium text-gray-700 mb-2">
              Branch Prefix
            </label>
            <input type="text" id="branch-prefix" value="intern/"
                   class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                   placeholder="intern/">
          </div>

          <div>
            <label for="pr-prefix" class="block text-sm font-medium text-gray-700 mb-2">
              PR Title Prefix
            </label>
            <input type="text" id="pr-prefix" value="[INTERN]"
                   class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                   placeholder="[INTERN]">
          </div>

          <div>
            <label for="max-retries" class="block text-sm font-medium text-gray-700 mb-2">
              Maximum Retries
            </label>
            <input type="number" id="max-retries" value="3" min="1" max="10"
                   class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>

          <div class="flex items-center">
            <input type="checkbox" id="auto-merge" class="mr-2">
            <label for="auto-merge" class="text-sm text-gray-700">
              Auto-merge PRs when all checks pass
            </label>
          </div>
        </div>
      </div>
    `;
  },

  toggleApiKeyInput() {
    const select = document.getElementById('coding-tool-choice');
    const container = document.getElementById('api-key-input');
    const label = document.getElementById('api-key-label');
    const input = document.getElementById('selected-api-key');
    
    if (select.value) {
      container.classList.remove('hidden');
      label.textContent = `${select.options[select.selectedIndex].text} API Key`;
      input.placeholder = select.value === 'amp' ? 'amp_xxxxxxxxxxxx' :
                         select.value === 'openai' ? 'sk-xxxxxxxxxxxx' :
                         'claude_xxxxxxxxxxxx';
    } else {
      container.classList.add('hidden');
    }
  },

  onboardingNext() {
    if (this.currentOnboardingStep < 3) {
      if (this.validateOnboardingStep()) {
        this.currentOnboardingStep++;
        this.updateOnboardingStep();
      }
    }
  },

  onboardingPrev() {
    if (this.currentOnboardingStep > 1) {
      this.currentOnboardingStep--;
      this.updateOnboardingStep();
    }
  },

  updateOnboardingStep() {
    const content = document.getElementById('onboarding-content');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const finishBtn = document.getElementById('finish-btn');
    const progressFill = document.getElementById('progress-fill');
    
    // Update step content
    if (this.currentOnboardingStep === 1) {
      content.innerHTML = this.renderOnboardingStep1();
    } else if (this.currentOnboardingStep === 2) {
      content.innerHTML = this.renderOnboardingStep2();
    } else if (this.currentOnboardingStep === 3) {
      content.innerHTML = this.renderOnboardingStep3();
    }
    
    // Update progress
    progressFill.style.width = `${(this.currentOnboardingStep / 3) * 100}%`;
    
    // Update step indicators
    document.querySelectorAll('.step').forEach((step, index) => {
      step.classList.remove('active', 'completed');
      if (index + 1 < this.currentOnboardingStep) {
        step.classList.add('completed');
      } else if (index + 1 === this.currentOnboardingStep) {
        step.classList.add('active');
      }
    });
    
    // Update buttons
    prevBtn.disabled = this.currentOnboardingStep === 1;
    if (this.currentOnboardingStep === 3) {
      nextBtn.classList.add('hidden');
      finishBtn.classList.remove('hidden');
    } else {
      nextBtn.classList.remove('hidden');
      finishBtn.classList.add('hidden');
    }
  },

  validateOnboardingStep() {
    if (this.currentOnboardingStep === 1) {
      const githubToken = document.getElementById('github-token').value;
      const codingTool = document.getElementById('coding-tool-choice').value;
      const apiKey = document.getElementById('selected-api-key').value;
      
      if (!githubToken) {
        Utils.showToast('GitHub token is required', 'error');
        return false;
      }
      
      if (!codingTool) {
        Utils.showToast('Please select a coding assistant', 'error');
        return false;
      }
      
      if (!apiKey) {
        Utils.showToast('API key is required for the selected coding tool', 'error');
        return false;
      }
      
      // Store data
      this.onboardingData.github_token = githubToken;
      this.onboardingData.default_coding_tool = codingTool;
      this.onboardingData[`${codingTool}_api_key`] = apiKey;
      
    } else if (this.currentOnboardingStep === 2) {
      const repoUrl = document.getElementById('github-repo').value;
      const username = document.getElementById('github-username').value;
      const pollInterval = document.getElementById('poll-interval').value;
      
      if (!repoUrl) {
        Utils.showToast('Repository URL is required', 'error');
        return false;
      }
      
      if (!username) {
        Utils.showToast('GitHub username is required', 'error');
        return false;
      }
      
      // Store data
      this.onboardingData.github_repo_url = repoUrl;
      this.onboardingData.github_username = username;
      this.onboardingData.poll_interval_seconds = pollInterval;
    }
    
    return true;
  },

  async completeOnboarding() {
    if (!this.validateOnboardingStep()) return;
    
    // Collect step 3 data
    this.onboardingData.branch_prefix = document.getElementById('branch-prefix').value;
    this.onboardingData.pr_prefix = document.getElementById('pr-prefix').value;
    this.onboardingData.max_retries = document.getElementById('max-retries').value;
    this.onboardingData.auto_merge = document.getElementById('auto-merge').checked ? 'true' : 'false';
    
    try {
      await API.completeOnboarding(this.onboardingData);
      Utils.showToast('Onboarding completed successfully!', 'success');
      App.navigate('/');
    } catch (error) {
      Utils.showToast(`Failed to complete onboarding: ${error.message}`, 'error');
    }
  },

  // New Task page
  async renderNewTask() {
    const container = document.getElementById('app');
    
    container.innerHTML = `
      <div class="max-w-2xl mx-auto py-8 px-4">
        <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
          <div class="mb-6">
            <h2 class="text-2xl font-bold text-gray-900 mb-2">Create New Task</h2>
            <p class="text-gray-600">Describe what you want the coding assistant to implement</p>
          </div>

          <form id="new-task-form" class="space-y-6" onsubmit="Pages.submitNewTask(event)">
            <!-- Task Title -->
            <div>
              <label for="task-title" class="block text-sm font-medium text-gray-700 mb-2">
                Task Title *
              </label>
              <input type="text" id="task-title" name="title" required
                     class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                     placeholder="e.g., Implement user authentication">
            </div>

            <!-- Task Description -->
            <div>
              <label for="task-description" class="block text-sm font-medium text-gray-700 mb-2">
                Description *
              </label>
              <textarea id="task-description" name="description" rows="6" required
                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Provide detailed requirements, acceptance criteria, and any specific implementation notes..."></textarea>
              <p class="text-sm text-gray-500 mt-1">Be specific about what you want implemented. Include examples, edge cases, and requirements.</p>
            </div>

            <!-- Coding Tool Selection -->
            <div>
              <label for="coding-tool" class="block text-sm font-medium text-gray-700 mb-2">
                Coding Assistant
              </label>
              <select id="coding-tool" name="codingTool" 
                      class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="amp">Amp (Default)</option>
                <option value="openai">OpenAI Codex</option>
                <option value="claude">Claude Code</option>
              </select>
            </div>

            <!-- Actions -->
            <div class="flex items-center justify-between pt-6 border-t border-gray-200">
              <button type="button" onclick="App.navigate('/')" 
                      class="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">
                Cancel
              </button>
              <button type="submit" 
                      class="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
                Create Task
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    // Load default coding tool from settings
    try {
      const settings = await API.getSettings('general');
      if (settings.default_coding_tool) {
        document.getElementById('coding-tool').value = settings.default_coding_tool;
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  },

  async submitNewTask(event) {
    event.preventDefault();
    
    const form = document.getElementById('new-task-form');
    const formData = new FormData(form);
    
    const taskData = {
      title: formData.get('title'),
      description: formData.get('description'),
      codingTool: formData.get('codingTool')
    };

    // Validate
    const errors = Utils.validateForm(taskData, {
      title: { required: true, minLength: 3, maxLength: 200, label: 'Title' },
      description: { required: true, minLength: 10, maxLength: 5000, label: 'Description' },
      codingTool: { required: true, label: 'Coding Tool' }
    });

    if (Object.keys(errors).length > 0) {
      const firstError = Object.values(errors)[0];
      Utils.showToast(firstError, 'error');
      return;
    }

    try {
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating...';

      const result = await API.createTask(taskData);
      Utils.showToast('Task created successfully!', 'success');
      App.navigate(`/task/${result.taskId}`);
    } catch (error) {
      Utils.showToast(`Failed to create task: ${error.message}`, 'error');
    } finally {
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Task';
    }
  }
};
