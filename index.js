require('dotenv').config({ path: '.env.dev.hugin' });
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./src/routes/auth');
const crawlerRoutes = require('./src/routes/crawler');
const searchRoutes = require('./src/routes/search');
const { initDatabase } = require('./src/db/couchdb');
const { startScheduler } = require('./src/services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/auth', authRoutes);
app.use('/', authRoutes); // Also mount auth routes at root for /callback
app.use('/api/crawler', crawlerRoutes);
app.use('/api/search', searchRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize database and start server
initDatabase()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Hugin server running on port ${PORT}`);
      if (process.env.DEVELOPMENT_MODE === 'true') {
        console.log('Development mode enabled');
      }
      if (process.env.BYPASS_AUTH === 'true') {
        console.log('Warning: Authentication bypass is enabled');
      }

      // Start scheduled crawler if enabled
      startScheduler();
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

module.exports = app;
