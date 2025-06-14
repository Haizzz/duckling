// Settings page functionality
class Settings {
  constructor() {
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
document.addEventListener('DOMContentLoaded', () => {
  new Settings();
});
