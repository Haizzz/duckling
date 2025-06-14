// API client with retry logic
window.API = {
  baseURL: '/api',
  
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            ...options.headers
          },
          ...options
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
          throw new Error(data.error || 'Request failed');
        }
        
        return data.data;
      } catch (error) {
        if (attempt === maxRetries) {
          console.error(`API request failed after ${maxRetries} attempts:`, error);
          throw error;
        }
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  },

  // Task endpoints
  async getTasks(filters = {}) {
    const query = Utils.buildQuery(filters);
    return this.request(`/tasks${query ? `?${query}` : ''}`);
  },

  async getTask(id) {
    return this.request(`/tasks/${id}`);
  },

  async createTask(taskData) {
    return this.request('/tasks', {
      method: 'POST',
      body: JSON.stringify(taskData)
    });
  },

  async updateTask(id, updates) {
    return this.request(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  },

  async cancelTask(id) {
    return this.request(`/tasks/${id}`, {
      method: 'DELETE'
    });
  },

  async retryTask(id) {
    return this.request(`/tasks/${id}/retry`, {
      method: 'POST'
    });
  },

  async getTaskLogs(id, filters = {}) {
    const query = Utils.buildQuery(filters);
    return this.request(`/tasks/${id}/logs${query ? `?${query}` : ''}`);
  },

  // Settings endpoints
  async getSettings(category) {
    const query = category ? `?category=${category}` : '';
    return this.request(`/settings${query}`);
  },

  async updateSettings(settings) {
    return this.request('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  },

  // Onboarding endpoints
  async getOnboardingStatus() {
    return this.request('/settings/onboarding');
  },

  async completeOnboarding(settings) {
    return this.request('/settings/onboarding', {
      method: 'POST',
      body: JSON.stringify({ settings })
    });
  },

  // Health check
  async getHealth() {
    return this.request('/health');
  },

  // Server-Sent Events for real-time updates
  createEventSource() {
    const eventSource = new EventSource('/api/events');
    
    eventSource.onerror = () => {
      console.log('EventSource failed, retrying in 5s...');
      setTimeout(() => {
        eventSource.close();
        this.createEventSource();
      }, 5000);
    };
    
    return eventSource;
  }
};
