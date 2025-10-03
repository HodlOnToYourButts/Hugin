const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { crawlUrl } = require('../services/crawler');
const { getDatabase } = require('../db/couchdb');

const router = express.Router();

// Submit URL for crawling
router.post('/submit', requireAuth, async (req, res) => {
  try {
    const { url, maxDepth } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Start crawling in background
    const crawlId = Date.now().toString();
    const crawlDepth = maxDepth || parseInt(process.env.CRAWLER_MAX_DEPTH) || 3;

    // Store crawl job
    const db = getDatabase();
    await db.insert({
      _id: `crawl_${crawlId}`,
      type: 'crawl_job',
      url,
      maxDepth: crawlDepth,
      status: 'pending',
      submittedBy: req.user.id,
      submittedAt: new Date().toISOString()
    });

    // Start crawling asynchronously
    crawlUrl(url, crawlDepth, crawlId).catch(err => {
      console.error(`Crawl job ${crawlId} failed:`, err);
    });

    res.json({
      message: 'Crawl job submitted',
      crawlId,
      url,
      maxDepth: crawlDepth
    });
  } catch (error) {
    console.error('Error submitting crawl job:', error);
    res.status(500).json({ error: 'Failed to submit crawl job' });
  }
});

// Get crawl job status
router.get('/status/:crawlId', requireAuth, async (req, res) => {
  try {
    const db = getDatabase();
    const doc = await db.get(`crawl_${req.params.crawlId}`);
    res.json(doc);
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404).json({ error: 'Crawl job not found' });
    } else {
      console.error('Error fetching crawl job:', error);
      res.status(500).json({ error: 'Failed to fetch crawl job status' });
    }
  }
});

// List all crawl jobs
router.get('/jobs', requireAuth, async (req, res) => {
  try {
    const db = getDatabase();
    const result = await db.find({
      selector: {
        type: 'crawl_job',
        submittedBy: req.user.id
      },
      sort: [{ submittedAt: 'desc' }],
      limit: 50
    });

    res.json({ jobs: result.docs });
  } catch (error) {
    console.error('Error listing crawl jobs:', error);
    res.status(500).json({ error: 'Failed to list crawl jobs' });
  }
});

module.exports = router;
