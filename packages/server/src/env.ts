import fs from 'fs';

// Automatically load .env for Node.js runtime if process.loadEnvFile is available
try {
  if (typeof process.loadEnvFile === 'function') {
    if (fs.existsSync('.env')) {
      process.loadEnvFile('.env');
    }
    if (fs.existsSync('packages/server/.env')) {
      process.loadEnvFile('packages/server/.env');
    }
    if (fs.existsSync('../../.env')) {
      process.loadEnvFile('../../.env');
    }
  }
} catch {
  // Ignore error if env file is already processed
}
