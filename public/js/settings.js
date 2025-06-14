// Settings page functionality
class Settings {
  constructor() {
    this.precommitChecks = [];
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadSettings();
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
    this.setSecureField('github-token', settings.githubToken);
    document.getElementById('github-username').value = settings.githubUsername || '';
    
    // Coding tools
    document.getElementById('default-coding-tool').value = settings.defaultCodingTool || 'amp';
    this.setSecureField('amp-api-key', settings.ampApiKey);
    this.setSecureField('openai-api-key', settings.openaiApiKey);
    
    // Task configuration
    document.getElementById('branch-prefix').value = settings.branchPrefix || 'intern/';
    document.getElementById('base-branch').value = settings.baseBranch || 'main';
    document.getElementById('pr-title-prefix').value = settings.prTitlePrefix || '[INTERN]';
    document.getElementById('commit-suffix').value = settings.commitSuffix || ' [i]';
    document.getElementById('max-retries').value = settings.maxRetries || 3;
    document.getElementById('poll-interval').value = settings.pollInterval || 30;
    document.getElementById('task-check-interval').value = settings.taskCheckInterval || 60;
    document.getElementById('review-check-interval').value = settings.reviewCheckInterval || 30;
    
    // Load precommit checks
    this.loadPrecommitChecks();
  }

  async saveSettings() {
    const formData = new FormData(document.getElementById('settings-form'));
    const settings = {};
    
    // Convert FormData to plain object
    for (const [key, value] of formData.entries()) {
      settings[key] = value;
    }
    
    // Convert numeric fields
    settings.maxRetries = parseInt(settings.maxRetries);
    settings.pollInterval = parseInt(settings.pollInterval);
    settings.taskCheckInterval = parseInt(settings.taskCheckInterval);
    settings.reviewCheckInterval = parseInt(settings.reviewCheckInterval);
    
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      
      if (response.ok) {
        this.showSuccess();
      } else {
        const error = await response.json();
        this.showError(error.message || 'Failed to save settings');
      }
    } catch (error) {
      this.showError('Failed to save settings: ' + error.message);
    }
  }

  showSuccess() {
    const successEl = document.getElementById('success-message');
    const errorEl = document.getElementById('error-message');
    
    errorEl.classList.add('hidden');
    successEl.classList.remove('hidden');
    
    // Hide success message after 3 seconds
    setTimeout(() => {
      successEl.classList.add('hidden');
    }, 3000);
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
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showError(message) {
    const successEl = document.getElementById('success-message');
    const errorEl = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    
    successEl.classList.add('hidden');
    errorText.textContent = message;
    errorEl.classList.remove('hidden');
  }
}

// Initialize settings when page loads
let settings;
document.addEventListener('DOMContentLoaded', () => {
  settings = new Settings();
});
