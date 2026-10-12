require('dotenv').config();
const { loadConfig } = require('./config');

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}

const { createApp } = require('./app');

createApp(config).listen(config.port, () => console.log(`🎓 Acadex API running on port ${config.port}`));
