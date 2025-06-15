// Simple app initialization with basic SPA routing
window.App = {
  eventSource: null,
  currentRoute: null,
  
  async init() {
    this.setupEventStream();
    this.setupRouter();
    this.hideLoading();
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      this.cleanup();
    });
  },

  cleanup() {
    if (this.eventSource) {
      console.log('Closing EventSource connection...');
      this.eventSource.close();
      this.eventSource = null;
    }
  },

  // Real-time updates via Server-Sent Events
  setupEventStream() {
    // Don't create multiple connections
    if (this.eventSource) {
      console.log('EventSource already exists, reusing...');
      return;
    }
    
    try {
      console.log('Creating new EventSource connection...');
      this.eventSource = new EventSource('/api/events');
      
      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleRealtimeUpdate(data);
        } catch (error) {
          console.error('Error parsing SSE data:', error);
        }
      };
      
      this.eventSource.onerror = () => {
        console.log('EventSource failed, will retry automatically...');
      };
    } catch (error) {
      console.error('Failed to setup event stream:', error);
    }
  },

  handleRealtimeUpdate(data) {
    if (data.type === 'task-update') {
      this.handleTaskUpdate(data);
      
      // Dispatch custom event for other components to listen to
      window.dispatchEvent(new CustomEvent('duckling-task-update', {
        detail: data
      }));
    } else if (data.type === 'heartbeat') {
      // Handle heartbeat if needed
    } else if (data.type === 'connected') {
      console.log('Connected to real-time updates');
    }
  },

  handleTaskUpdate(data) {
    // Notify dashboard to refresh if we're on main page and dashboard exists
    if (window.Dashboard) {
      window.Dashboard.handleTaskUpdate(data);
    }
  },

  hideLoading() {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.style.display = 'none';
    }
  },

  showError(title, message) {
    console.error(`${title}: ${message}`);
    // Simple error display - could be enhanced
    alert(`${title}: ${message}`);
  }
};

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
