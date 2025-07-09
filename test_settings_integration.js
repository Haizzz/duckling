// Test integration of custom prompt with settings manager
const { SettingsManager } = require('./dist/core/settings-manager');
const { createCodingPrompt } = require('./dist/core/prompts');

// Mock database for testing
const mockDb = {
  getSetting: (key) => {
    if (key === 'customPrompt') {
      return { value: 'Custom test prompt: Follow these steps.\n\nTask:' };
    }
    return null;
  },
  setSetting: (key, value) => {
    console.log(`Setting ${key} = ${value}`);
  }
};

// Test the flow
const settingsManager = new SettingsManager(mockDb);
const customPrompt = settingsManager.get('customPrompt');

console.log('Custom prompt from settings:', customPrompt);
console.log('\nFinal coding prompt:');
console.log(createCodingPrompt('Add a new feature', customPrompt));
