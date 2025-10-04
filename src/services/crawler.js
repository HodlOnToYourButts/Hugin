const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { URL } = require('url');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../db/couchdb');
const { isAllowedByRobots, getCrawlDelay, getSitemapUrls } = require('./robots');

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

function isLocalhost(hostname) {
  return hostname === 'localhost' ||
         hostname === '127.0.0.1' ||
         hostname.startsWith('192.168.') ||
         hostname.startsWith('10.') ||
         hostname.startsWith('172.16.') ||
         hostname.startsWith('[::1]');
}

function isAllowedDomain(hostname) {
  // In development mode, allow localhost
  if (process.env.DEVELOPMENT_MODE === 'true' && isLocalhost(hostname)) {
    return true;
  }
  // Always allow Yggdrasil domains
  return isYggdrasilDomain(hostname);
}

function convertUrlForCrawling(url) {
  // In development mode, convert localhost URLs to host.docker.internal for crawling
  if (process.env.DEVELOPMENT_MODE === 'true') {
    try {
      const urlObj = new URL(url);
      if (isLocalhost(urlObj.hostname)) {
        urlObj.hostname = 'host.docker.internal';
        return urlObj.href;
      }
    } catch (error) {
      // Invalid URL, return as-is
    }
  }
  return url;
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

    // Try to get sitemap URLs and add them to the queue
    try {
      const sitemapUrls = await getSitemapUrls(baseUrl.origin);
      if (sitemapUrls.length > 0 && process.env.DEVELOPMENT_MODE === 'true') {
        console.log(`Found ${sitemapUrls.length} URLs in sitemap`);
      }
      for (const sitemapUrl of sitemapUrls) {
        try {
          const urlObj = new URL(sitemapUrl);
          if (urlObj.hostname === baseDomain && isAllowedDomain(urlObj.hostname)) {
            const normalized = normalizeUrl(sitemapUrl);
            if (!visitedUrls.has(normalized)) {
              queue.push({ url: normalized, depth: 1 });
            }
          }
        } catch (error) {
          // Skip invalid URLs
        }
      }
    } catch (error) {
      // Sitemap not available, continue with normal crawling
    }

    let processedPages = 0;
    const maxPages = parseInt(process.env.CRAWLER_MAX_PAGES) || 100;
    const defaultDelay = parseInt(process.env.CRAWLER_DELAY_MS) || 1000;

    // Get crawl delay from robots.txt
    const robotsDelay = await getCrawlDelay(normalizedStartUrl);
    const delay = Math.max(defaultDelay, robotsDelay * 1000); // Convert to ms

    while (queue.length > 0 && processedPages < maxPages) {
      const { url, depth } = queue.shift();

      // Skip if already visited or max depth reached
      if (visitedUrls.has(url) || depth > maxDepth) {
        continue;
      }

      // Check robots.txt
      const allowed = await isAllowedByRobots(url);
      if (!allowed) {
        if (process.env.DEVELOPMENT_MODE === 'true') {
          console.log(`Skipping ${url} (disallowed by robots.txt)`);
        }
        continue;
      }

      try {
        // Convert URL for actual crawling (localhost -> host.docker.internal in dev mode)
        const crawlUrl = convertUrlForCrawling(url);
        const pageData = await fetchAndParsePage(crawlUrl);

        if (pageData) {
          // Store the original URL (localhost) not the converted one
          pageData.url = url;

          // Save page to database
          await savePage(pageData, crawlId);
          visitedUrls.add(url);
          processedPages++;

          // Extract and queue links if not at max depth
          if (depth < maxDepth && pageData.links) {
            for (const link of pageData.links) {
              try {
                const linkUrl = new URL(link, crawlUrl);

                // Convert back to localhost if it's host.docker.internal
                let finalLinkUrl = linkUrl.href;
                if (process.env.DEVELOPMENT_MODE === 'true' && linkUrl.hostname === 'host.docker.internal') {
                  linkUrl.hostname = 'localhost';
                  finalLinkUrl = linkUrl.href;
                }

                const normalizedLinkUrl = normalizeUrl(finalLinkUrl);
                const linkHostname = new URL(normalizedLinkUrl).hostname;

                // Only crawl links from the same domain and that are allowed domains
                if (linkHostname === baseDomain &&
                    isAllowedDomain(linkHostname) &&
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
    const response = await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Check X-Robots-Tag HTTP header
    const headers = response.headers();
    const xRobotsTag = headers['x-robots-tag'] || '';
    const xRobotsDirectives = xRobotsTag.toLowerCase().split(',').map(d => d.trim());

    const xRobotsNoindex = xRobotsDirectives.includes('noindex') || xRobotsDirectives.includes('none');
    const xRobotsNofollow = xRobotsDirectives.includes('nofollow') || xRobotsDirectives.includes('none');
    const xRobotsNosnippet = xRobotsDirectives.includes('nosnippet');

    // If X-Robots-Tag has noindex, skip this page
    if (xRobotsNoindex) {
      if (process.env.DEVELOPMENT_MODE === 'true') {
        console.log(`Skipping ${url} (X-Robots-Tag: noindex)`);
      }
      return null;
    }

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

    // Extract metadata first (before removing elements)
    const title = $('title').text().trim();
    const metaDescription = $('meta[name="description"]').attr('content') || '';
    const metaKeywords = $('meta[name="keywords"]').attr('content') || '';
    const metaAuthor = $('meta[name="author"]').attr('content') || '';
    const metaCopyright = $('meta[name="copyright"]').attr('content') || '';
    const metaContentType = $('meta[http-equiv="Content-Type"]').attr('content') ||
                           $('meta[name="content-type"]').attr('content') || '';

    // Check robots meta tag directives
    const robotsMeta = $('meta[name="robots"]').attr('content') || '';
    const robotsDirectives = robotsMeta.toLowerCase().split(',').map(d => d.trim());

    // Check for noindex - if present, don't index this page (combine with X-Robots-Tag)
    const noindex = robotsDirectives.includes('noindex') || robotsDirectives.includes('none');

    // Check for nofollow - if present, don't follow links on this page (combine with X-Robots-Tag)
    const nofollow = robotsDirectives.includes('nofollow') || robotsDirectives.includes('none') || xRobotsNofollow;

    // Check for nosnippet - if present, don't store description/snippets (combine with X-Robots-Tag)
    const nosnippet = robotsDirectives.includes('nosnippet') || xRobotsNosnippet;

    // If noindex, return null to skip indexing
    if (noindex) {
      if (process.env.DEVELOPMENT_MODE === 'true') {
        console.log(`Skipping ${url} (meta robots noindex)`);
      }
      return null;
    }

    // Remove non-content elements for better content extraction
    $('script, style, noscript').remove();
    $('nav, header, footer, aside').remove();
    $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove();
    $('[class*="nav"], [class*="menu"], [class*="sidebar"]').remove();
    $('[class*="header"], [class*="footer"]').remove();
    $('button, [type="button"], [type="submit"]').remove();
    $('.loading, .spinner, [class*="loading"]').remove();
    $('[aria-hidden="true"]').remove();

    // Remove elements with data-nosnippet attribute per Google spec
    $('[data-nosnippet]').remove();

    // Try to find main content area
    const mainContent = $('main, article, [role="main"], .content, .post, .article').first();
    const content = (mainContent.length > 0 ? mainContent : $('body'))
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    const urlObj = new URL(url);

    if (process.env.DEVELOPMENT_MODE === 'true') {
      console.log(`Found ${links.length} links on ${url}`);
    }

    return {
      url,
      domain: urlObj.hostname,
      title,
      metaDescription: nosnippet ? '' : metaDescription, // Don't store snippets if nosnippet
      metaKeywords,
      metaAuthor,
      metaCopyright,
      metaContentType,
      content,
      links: nofollow ? [] : links, // Don't return links if nofollow
      nofollow, // Store the directive so we know not to follow links later
      nosnippet, // Store the directive
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
      // Update existing page
      doc._id = existing.docs[0]._id;
      doc._rev = existing.docs[0]._rev;
    } else {
      // Create new page with UUID
      doc._id = `page:${uuidv4()}`;
    }

    await db.insert(doc);
  } catch (error) {
    console.error('Error saving page:', error);
  }
}

async function updateCrawlJob(crawlId, updates) {
  const db = getDatabase();

  try {
    const doc = await db.get(`crawl:${crawlId}`);
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
