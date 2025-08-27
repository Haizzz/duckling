// Settings page functionality
class Settings {
  constructor() {
    this.precommitChecks = [];
    this.repositories = [];
    this.init();
  }

  async init() {
    this.bindEvents();
    // Load settings and repositories sequentially to avoid race conditions
    await this.loadSettings();
    await this.loadRepositories();
  }

  bindEvents() {
    document.getElementById('settings-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveSettings();
    });

    // Add precommit check button
    document.getElementById('add-precommit-btn').addEventListener('click', () => {
      this.addPrecommitCheck();
    });

    // Enter key in precommit input
    document.getElementById('precommit-command').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.addPrecommitCheck();
      }
    });

    // Add repository button
    document.getElementById('add-repo-btn').addEventListener('click', () => {
      this.addRepository();
    });

    // Enter key in repository input
    document.getElementById('repo-path').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.addRepository();
      }
    });
  }

  async loadSettings() {
    const loading = document.getElementById('loading-settings');
    const form = document.getElementById('settings-form');

    try {
      const response = await fetch('/api/settings');
      const result = await response.json();

      if (response.ok) {
        this.populateForm(result.data);
        loading.classList.add('hidden');
        form.classList.remove('hidden');
      } else {
        this.showError('Failed to load settings');
      }
    } catch (error) {
      this.showError('Failed to load settings: ' + error.message);
    }
  }

  populateForm(settings) {
    // GitHub settings
    // GitHub CLI status is handled in the HTML

    // Coding tools
    document.getElementById('default-coding-tool').value = settings.defaultCodingTool || 'amp';
    this.setSecureField('openai-api-key', settings.openaiApiKey);

    // Integration settings
    document.getElementById('jira-email').value = settings.jiraEmail || '';
    this.setSecureField('jira-api-key', settings.jiraApiKey);
    document.getElementById('jira-base-url').value = settings.jiraBaseUrl || '';
    document.getElementById('jira-jql-query').value = settings.jiraJqlQuery || '';
    // Store Jira repository setting
    this.selectedJiraRepository = settings.jiraRepository || '';

    // Task configuration
    document.getElementById('custom-prompt').value = settings.customPrompt || '';
    document.getElementById('branch-prefix').value = settings.branchPrefix || 'duckling-';
    document.getElementById('pr-title-prefix').value = settings.prTitlePrefix || '[DUCKLING]';
    document.getElementById('commit-suffix').value = settings.commitSuffix || ' [quack]';
    document.getElementById('comment-prefix').value = settings.commentPrefix || 'duckling';
    document.getElementById('max-retries').value = settings.maxRetries || 3;
    document.getElementById('skip-username-check').checked = settings.skipUsernameCheck || false;


    // Show configuration status
    this.showConfigurationStatus(settings);

    // Load precommit checks
    this.loadPrecommitChecks();
    
    // The Jira repository dropdown will be updated when repositories are loaded
    // in the sequential loading process
  }

  async saveSettings() {
    const formData = new FormData(document.getElementById('settings-form'));
    const settings = {};

    // Convert FormData to plain object
    for (const [key, value] of formData.entries()) {
      settings[key] = value;
    }

    settings.skipUsernameCheck = formData.has('skipUsernameCheck');

    // Convert numeric fields
    settings.maxRetries = parseInt(settings.maxRetries);


    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Settings save response:', result);
        let message = 'Settings saved successfully!'; // Default fallback

        // Try to get message from server response
        if (result && result.data && result.data.message) {
          message = result.data.message;
        }

        console.log('Toast message:', message);
        this.showSettingsSaveSuccess(message);
      } else {
        const error = await response.json();
        console.error('Server error saving settings:', error);
        this.showError(error.message || error.error || 'Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      this.showError('Failed to save settings: ' + error.message);
    }
  }



  setSecureField(fieldId, value) {
    const field = document.getElementById(fieldId);

    if (value === '***CONFIGURED***') {
      // Show that field is configured with placeholder
      field.value = '';
      field.placeholder = '••••••••••••••••';
    } else {
      // Field is empty
      field.value = '';
      field.placeholder = 'Enter value...';
    }
  }



  async loadPrecommitChecks() {
    try {
      const response = await fetch('/api/precommit-checks');
      const result = await response.json();

      if (response.ok && result.success) {
        this.precommitChecks = result.data || [];
        this.renderPrecommitChecks();
      }
    } catch (error) {
      console.error('Failed to load precommit checks:', error);
    }
  }

  addPrecommitCheck() {
    const commandInput = document.getElementById('precommit-command');
    const command = commandInput.value.trim();

    if (!command) return;

    // Add to API
    this.savePrecommitCheck(command);

    // Clear input
    commandInput.value = '';
  }

  async savePrecommitCheck(command) {
    try {
      const response = await fetch('/api/precommit-checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: command, command, required: true })
      });

      if (response.ok) {
        // Reload the list
        this.loadPrecommitChecks();
      } else {
        this.showError('Failed to add precommit check');
      }
    } catch (error) {
      this.showError('Failed to add precommit check: ' + error.message);
    }
  }

  async removePrecommitCheck(id) {
    try {
      const response = await fetch(`/api/precommit-checks/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        // Reload the list
        this.loadPrecommitChecks();
      } else {
        this.showError('Failed to remove precommit check');
      }
    } catch (error) {
      this.showError('Failed to remove precommit check: ' + error.message);
    }
  }

  renderPrecommitChecks() {
    const container = document.getElementById('precommit-list');

    if (this.precommitChecks.length === 0) {
      container.innerHTML = '<p class="text-sm text-gray-500 italic">No precommit checks configured</p>';
      return;
    }

    container.innerHTML = this.precommitChecks.map(check => `
      <div class="flex items-center justify-between p-3 bg-gray-50 rounded-md">
        <div class="flex-1">
          <code class="text-sm font-mono text-gray-800">${this.escapeHtml(check.command)}</code>
        </div>
        <button 
          onclick="settings.removePrecommitCheck(${check.id})"
          class="ml-3 text-red-600 hover:text-red-800 focus:outline-none"
          title="Remove check"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path>
          </svg>
        </button>
      </div>
    `).join('');
  }

  escapeHtml(text) {
    return Utils.escapeHtml(text || '');
  }

  showConfigurationStatus(settings) {
    const statusEl = document.getElementById('config-status');

    // GitHub CLI is guaranteed to be available if server is running
    const hasOpenAiTool = settings.openaiApiKey === '***CONFIGURED***';

    const missingRequirements = [];

    // Optional warnings
    const warnings = [];
    if (!hasOpenAiTool) warnings.push('OpenAI API key (optional - for commit messages and OpenAI coding)');

    if (missingRequirements.length === 0) {
      // No blocking issues
      if (warnings.length === 0) {
        // Everything is configured
        statusEl.className = 'bg-green-50 border border-green-200 rounded-lg p-4';
        statusEl.innerHTML = `
          <div class="flex items-center">
            <div class="flex-shrink-0">
              <svg class="h-5 w-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
              </svg>
            </div>
            <div class="ml-3">
              <h3 class="text-sm font-medium text-green-800">Ready to Go!</h3>
              <p class="text-sm text-green-700 mt-1">Duckling is ready to create tasks. All optional features are configured!</p>
            </div>
          </div>
        `;
      } else {
        // Show optional warnings
        statusEl.className = 'bg-blue-50 border border-blue-200 rounded-lg p-4';
        statusEl.innerHTML = `
          <div class="flex items-start">
            <div class="flex-shrink-0">
              <svg class="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path>
              </svg>
            </div>
            <div class="ml-3">
              <h3 class="text-sm font-medium text-blue-800">Ready to Go!</h3>
              <p class="text-sm text-blue-700 mt-1">Duckling is ready to create tasks. Optional features missing: ${warnings.join(', ')}</p>
            </div>
          </div>
        `;
      }
    } else {
      // Missing requirements
      const toolsText = missingRequirements.includes('at least one coding tool (Amp or OpenAI)')
        ? '<li><strong>Coding Tool:</strong> Configure either Amp (requires Amp token) or OpenAI (for code generation)</li>'
        : '';

      const openaiText = missingRequirements.includes('OpenAI API key')
        ? '<li><strong>OpenAI API Key:</strong> Required for commit messages and task summaries</li>'
        : '';

      statusEl.className = 'bg-red-50 border border-red-200 rounded-lg p-4';
      statusEl.innerHTML = `
        <div class="flex items-start">
          <div class="flex-shrink-0">
            <svg class="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path>
            </svg>
          </div>
          <div class="ml-3">
            <h3 class="text-sm font-medium text-red-800">Configuration Incomplete</h3>
            <div class="mt-2 text-sm text-red-700">
              <p class="mb-2">The following settings are required to create tasks:</p>
              <ul class="list-disc list-inside space-y-1">
                ${openaiText}${toolsText}
              </ul>
            </div>
          </div>
        </div>
      `;
    }

    statusEl.classList.remove('hidden');
  }

  showError(message) {
    Utils.showToast(message, 'error');
  }

  showSuccess(message) {
    Utils.showToast(message, 'success');
  }

  showSettingsSaveSuccess(message) {
    // Ensure we always have a message
    const finalMessage = message && message.trim() ? message : 'Settings saved successfully!';
    Utils.showToast(finalMessage, 'success');

    // Also refresh the configuration status for settings saves
    setTimeout(() => {
      this.loadSettings();
    }, 500);
  }

  async loadRepositories() {
    try {
      const response = await fetch('/api/repositories');
      const result = await response.json();

      if (response.ok) {
        this.repositories = result.data;
        this.renderRepositories();
      } else {
        this.showError('Failed to load repositories');
      }
    } catch (error) {
      this.showError('Failed to load repositories: ' + error.message);
    }
  }

  renderRepositories() {
    const container = document.getElementById('repository-list');
    const warningEl = document.getElementById('no-repos-warning');

    if (this.repositories.length === 0) {
      warningEl.classList.remove('hidden');
      container.innerHTML = '';
      this.updateJiraRepositoryDropdown();
      return;
    }

    warningEl.classList.add('hidden');
    container.innerHTML = this.repositories.map(repo => `
      <div class="flex items-center justify-between p-3 bg-gray-50 rounded-md">
        <div class="flex-1">
          <div class="font-medium text-gray-900">${repo.name}</div>
          <div class="text-sm text-gray-600 mt-1">${repo.path}</div>
        </div>
        <button 
          onclick="settings.removeRepository(${repo.id})"
          class="text-red-600 hover:text-red-800 font-medium text-sm"
        >
          Remove
        </button>
      </div>
    `).join('');

    // Update the Jira repository dropdown
    this.updateJiraRepositoryDropdown();
  }

  updateJiraRepositoryDropdown() {
    const dropdown = document.getElementById('jira-repository');

    // Clear existing options except the first one
    dropdown.innerHTML = '<option value="">-- Select a repository --</option>';

    // Add repository options
    this.repositories.forEach(repo => {
      const option = document.createElement('option');
      option.value = repo.path;
      option.textContent = `${repo.name} (${repo.path})`;
      dropdown.appendChild(option);
    });

    // Set the selected value if we have one stored
    if (this.selectedJiraRepository) {
      dropdown.value = this.selectedJiraRepository;

      // Check if the selected repository still exists
      const repoExists = this.repositories.some(repo => repo.path === this.selectedJiraRepository);
      if (!repoExists) {
        // Repository was removed, clear the selection and save settings
        this.selectedJiraRepository = '';
        dropdown.value = '';
        this.clearJiraRepositorySetting();
      }
    }
  }

  async clearJiraRepositorySetting() {
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jiraRepository: '' })
      });

      if (response.ok) {
        console.log('Cleared Jira repository setting due to repository removal');
      } else {
        console.error('Failed to clear Jira repository setting');
      }
    } catch (error) {
      console.error('Error clearing Jira repository setting:', error);
    }
  }

  async addRepository() {
    const pathInput = document.getElementById('repo-path');
    const path = pathInput.value.trim();

    if (!path) {
      this.showError('Please enter a repository path');
      return;
    }

    const addBtn = document.getElementById('add-repo-btn');
    const originalText = addBtn.textContent;
    addBtn.textContent = 'Adding...';
    addBtn.disabled = true;

    try {
      const response = await fetch('/api/repositories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path }),
      });

      const result = await response.json();

      if (response.ok) {
        this.showSuccess('Repository added successfully');
        pathInput.value = '';
        this.loadRepositories(); // Reload the list
      } else {
        this.showError(result.error || 'Failed to add repository');
      }
    } catch (error) {
      this.showError('Failed to add repository: ' + error.message);
    } finally {
      addBtn.textContent = originalText;
      addBtn.disabled = false;
    }
  }

  async removeRepository(repoId) {
    // Find the repository being removed
    const repoToRemove = this.repositories.find(repo => repo.id === repoId);

    let confirmMessage = 'Are you sure you want to remove this repository? Existing tasks will not be deleted.';
    if (repoToRemove && this.selectedJiraRepository === repoToRemove.path) {
      confirmMessage += '\n\nThis repository is currently selected for Jira integration and will be disabled.';
    }

    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      const response = await fetch(`/api/repositories/${repoId}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (response.ok) {
        this.showSuccess('Repository removed successfully');
        this.loadRepositories(); // Reload the list
      } else {
        this.showError(result.error || 'Failed to remove repository');
      }
    } catch (error) {
      this.showError('Failed to remove repository: ' + error.message);
    }
  }
}

// Initialize settings when page loads
let settings;
document.addEventListener('DOMContentLoaded', () => {
  settings = new Settings();
});
