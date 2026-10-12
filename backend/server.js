require('dotenv').config();
const { createApp } = require('./app');

const PORT = process.env.PORT || 5000;

createApp().listen(PORT, () => console.log(`🎓 Acadex API running on port ${PORT}`));
