const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { URL } = require('url');
const { getDatabase } = require('../db/couchdb');

const visitedUrls = new Set();
const crawlQueues = new Map();
let browser = null;

function normalizeUrl(url) {
  const urlObj = new URL(url);
  // Remove trailing slash from pathname, unless it's the root
  if (urlObj.pathname.length > 1 && urlObj.pathname.endsWith('/')) {
    urlObj.pathname = urlObj.pathname.slice(0, -1);
  }
  // Ensure root path has a trailing slash
  if (urlObj.pathname === '') {
    urlObj.pathname = '/';
  }
  // Remove fragment
  urlObj.hash = '';
  return urlObj.href;
}

function isYggdrasilDomain(hostname) {
  return hostname.endsWith('.ygg') || hostname.endsWith('.anon');
}

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
  }
  return browser;
}

async function crawlUrl(startUrl, maxDepth = 3, crawlId) {
  const db = getDatabase();
  const normalizedStartUrl = normalizeUrl(startUrl);
  const baseUrl = new URL(normalizedStartUrl);
  const baseDomain = baseUrl.hostname;

  try {
    // Ensure browser is launched
    await getBrowser();

    // Update job status
    await updateCrawlJob(crawlId, { status: 'running', startedAt: new Date().toISOString() });

    const queue = [{ url: normalizedStartUrl, depth: 0 }];
    crawlQueues.set(crawlId, queue);

    let processedPages = 0;
    const maxPages = parseInt(process.env.CRAWLER_MAX_PAGES) || 100;
    const delay = parseInt(process.env.CRAWLER_DELAY_MS) || 1000;

    while (queue.length > 0 && processedPages < maxPages) {
      const { url, depth } = queue.shift();

      // Skip if already visited or max depth reached
      if (visitedUrls.has(url) || depth > maxDepth) {
        continue;
      }

      try {
        const pageData = await fetchAndParsePage(url);

        if (pageData) {
          // Save page to database
          await savePage(pageData, crawlId);
          visitedUrls.add(url);
          processedPages++;

          // Extract and queue links if not at max depth
          if (depth < maxDepth && pageData.links) {
            for (const link of pageData.links) {
              try {
                const linkUrl = new URL(link, url);
                const normalizedLinkUrl = normalizeUrl(linkUrl.href);

                // Only crawl links from the same domain and that are Yggdrasil domains
                if (linkUrl.hostname === baseDomain &&
                    isYggdrasilDomain(linkUrl.hostname) &&
                    !visitedUrls.has(normalizedLinkUrl)) {
                  queue.push({ url: normalizedLinkUrl, depth: depth + 1 });
                }
              } catch (error) {
                // Skip invalid URLs
                if (process.env.DEVELOPMENT_MODE === 'true') {
                  console.log(`Skipping invalid URL: ${link}`);
                }
              }
            }
          }

          if (process.env.DEVELOPMENT_MODE === 'true') {
            console.log(`Crawled: ${url} (depth: ${depth}, pages: ${processedPages})`);
          }
        }

        // Delay between requests to be polite
        await sleep(delay);
      } catch (error) {
        console.error(`Error crawling ${url}:`, error.message);
      }
    }

    await updateCrawlJob(crawlId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      pagesProcessed: processedPages
    });

    crawlQueues.delete(crawlId);
  } catch (error) {
    console.error(`Crawl job ${crawlId} error:`, error);
    await updateCrawlJob(crawlId, {
      status: 'failed',
      error: error.message,
      failedAt: new Date().toISOString()
    });
  }
}

async function fetchAndParsePage(url) {
  const page = await browser.newPage();

  try {
    // Set user agent
    await page.setUserAgent('Hugin-Webcrawler/0.0.1');

    // Navigate to the page and wait for network to be idle
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Wait for any dynamic content to load
    await page.waitForTimeout(3000);

    // Extract links directly from the DOM (before cheerio processing)
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return anchors.map(a => a.href).filter(href =>
        href && !href.startsWith('#') && !href.startsWith('javascript:')
      );
    });

    // Get the rendered HTML for content extraction
    const html = await page.content();
    const $ = cheerio.load(html);

    // Remove script and style elements
    $('script, style, nav, footer, header').remove();

    // Extract text content
    const title = $('title').text().trim();
    const metaDescription = $('meta[name="description"]').attr('content') || '';
    const content = $('body').text().replace(/\s+/g, ' ').trim();

    const urlObj = new URL(url);

    if (process.env.DEVELOPMENT_MODE === 'true') {
      console.log(`Found ${links.length} links on ${url}`);
    }

    return {
      url,
      domain: urlObj.hostname,
      title,
      metaDescription,
      content,
      links,
      crawledAt: new Date().toISOString()
    };
  } catch (error) {
    if (process.env.DEVELOPMENT_MODE === 'true') {
      console.error(`Failed to fetch ${url}:`, error.message);
    }
    return null;
  } finally {
    await page.close();
  }
}

async function savePage(pageData, crawlId) {
  const db = getDatabase();

  try {
    // Check if page already exists
    const existing = await db.find({
      selector: {
        type: 'page',
        url: pageData.url
      },
      limit: 1
    });

    const doc = {
      type: 'page',
      ...pageData,
      crawlId,
      updatedAt: new Date().toISOString()
    };

    if (existing.docs.length > 0) {
      doc._id = existing.docs[0]._id;
      doc._rev = existing.docs[0]._rev;
    }

    await db.insert(doc);
  } catch (error) {
    console.error('Error saving page:', error);
  }
}

async function updateCrawlJob(crawlId, updates) {
  const db = getDatabase();

  try {
    const doc = await db.get(`crawl_${crawlId}`);
    await db.insert({
      ...doc,
      ...updates
    });
  } catch (error) {
    console.error('Error updating crawl job:', error);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  crawlUrl
};
