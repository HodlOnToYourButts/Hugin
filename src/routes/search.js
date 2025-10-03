const express = require('express');
const { optionalAuth } = require('../middleware/auth');
const { searchContent } = require('../services/search');

const router = express.Router();

// Search endpoint for Munin and other services
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { q, domain, limit = 20, offset = 0 } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Search query (q) is required' });
    }

    const results = await searchContent({
      query: q,
      domain,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get page by URL
router.get('/page', optionalAuth, async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    const { getDatabase } = require('../db/couchdb');
    const db = getDatabase();

    const result = await db.find({
      selector: {
        type: 'page',
        url: url
      },
      limit: 1
    });

    if (result.docs.length === 0) {
      return res.status(404).json({ error: 'Page not found' });
    }

    res.json(result.docs[0]);
  } catch (error) {
    console.error('Error fetching page:', error);
    res.status(500).json({ error: 'Failed to fetch page' });
  }
});

module.exports = router;
