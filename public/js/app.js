// Simple app initialization with basic SPA routing
window.App = {
  eventSource: null,
  currentRoute: null,
  
  async init() {
    this.setupEventStream();
    this.setupRouter();
    this.hideLoading();
  },

  // Real-time updates via Server-Sent Events
  setupEventStream() {
    try {
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
