// Simple test to verify custom prompt functionality
const { createCodingPrompt } = require('./dist/core/prompts');

// Test with default prompt
const defaultPrompt = createCodingPrompt('Add a button to the page');
console.log('=== DEFAULT PROMPT ===');
console.log(defaultPrompt);

// Test with custom prompt
const customPrompt = createCodingPrompt('Add a button to the page', 'You are a helpful assistant focused on React development. Please follow these steps:\n1. Create clean, modern React components\n2. Use TypeScript for type safety\n3. Follow React best practices\n\nTask:');
console.log('\n=== CUSTOM PROMPT ===');
console.log(customPrompt);
