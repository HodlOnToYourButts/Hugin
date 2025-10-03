const { getDatabase } = require('../db/couchdb');
const { crawlUrl } = require('./crawler');

let schedulerInterval = null;

function calculateNextRunTime(hour, minute) {
  const now = new Date();
  const scheduled = new Date();
  scheduled.setHours(hour, minute, 0, 0);

  // If scheduled time has passed today, schedule for tomorrow
  if (scheduled <= now) {
    scheduled.setDate(scheduled.getDate() + 1);
  }

  return scheduled;
}

function calculateTimeUntilNext(hour, minute) {
  const nextRun = calculateNextRunTime(hour, minute);
  return nextRun.getTime() - Date.now();
}

async function runScheduledCrawls() {
  if (process.env.ENABLE_SCHEDULED_CRAWLS !== 'true') {
    return;
  }

  try {
    const db = getDatabase();

    // Find all unique URLs that have been crawled before
    const result = await db.find({
      selector: {
        type: 'page'
      },
      fields: ['url'],
      limit: 10000
    });

    // Get unique root URLs (just the origin)
    const rootUrls = new Set();
    result.docs.forEach(doc => {
      try {
        const url = new URL(doc.url);
        rootUrls.add(url.origin);
      } catch (error) {
        // Skip invalid URLs
      }
    });

    console.log(`Starting scheduled recrawl of ${rootUrls.size} sites`);

    // Recrawl each root URL
    for (const rootUrl of rootUrls) {
      const crawlId = `scheduled_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const maxDepth = parseInt(process.env.CRAWLER_MAX_DEPTH) || 3;

      console.log(`Scheduled recrawl: ${rootUrl}`);

      // Start crawl asynchronously (don't wait for it to complete)
      crawlUrl(rootUrl, maxDepth, crawlId).catch(err => {
        console.error(`Scheduled crawl failed for ${rootUrl}:`, err);
      });

      // Add a small delay between starting crawls to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    console.log('Scheduled recrawls initiated');
  } catch (error) {
    console.error('Error running scheduled crawls:', error);
  }
}

function scheduleNextRun(hour, minute) {
  const timeUntilNext = calculateTimeUntilNext(hour, minute);
  const nextRun = new Date(Date.now() + timeUntilNext);

  console.log(`Next scheduled crawl: ${nextRun.toISOString()}`);

  schedulerInterval = setTimeout(() => {
    runScheduledCrawls();
    // Schedule the next run for tomorrow
    scheduleNextRun(hour, minute);
  }, timeUntilNext);
}

function startScheduler() {
  if (process.env.ENABLE_SCHEDULED_CRAWLS !== 'true') {
    console.log('Scheduled crawls disabled (ENABLE_SCHEDULED_CRAWLS=false)');
    return;
  }

  const hour = parseInt(process.env.CRAWL_SCHEDULE_HOUR) || 0;
  const minute = parseInt(process.env.CRAWL_SCHEDULE_MINUTE) || 0;

  console.log(`Scheduled crawls enabled: Daily at ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);

  scheduleNextRun(hour, minute);
}

function stopScheduler() {
  if (schedulerInterval) {
    clearTimeout(schedulerInterval);
    schedulerInterval = null;
    console.log('Scheduler stopped');
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  runScheduledCrawls
};
