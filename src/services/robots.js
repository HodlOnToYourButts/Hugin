const axios = require('axios');
const robotsParser = require('robots-parser');

const robotsCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function convertOriginForFetch(origin) {
  // In development mode, convert localhost to host.docker.internal
  if (process.env.DEVELOPMENT_MODE === 'true') {
    try {
      const url = new URL(origin);
      const hostname = url.hostname;

      if (hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname.startsWith('192.168.') ||
          hostname.startsWith('10.') ||
          hostname.startsWith('172.16.') ||
          hostname.startsWith('[::1]')) {
        url.hostname = 'host.docker.internal';
        return url.origin;
      }
    } catch (error) {
      // Invalid URL, return as-is
    }
  }
  return origin;
}

async function getRobotsTxt(origin) {
  const robotsUrl = `${origin}/robots.txt`;

  // Convert for fetching (localhost -> host.docker.internal in dev mode)
  const fetchOrigin = convertOriginForFetch(origin);
  const fetchUrl = `${fetchOrigin}/robots.txt`;

  // Check cache using original origin
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.parser;
  }

  try {
    const response = await axios.get(fetchUrl, {
      timeout: 5000,
      validateStatus: (status) => status === 200 || status === 404
    });

    let robotsTxt = '';
    if (response.status === 200) {
      robotsTxt = response.data;
    }

    // Parse robots.txt
    const parser = robotsParser(robotsUrl, robotsTxt);

    // Cache the result
    robotsCache.set(origin, {
      parser,
      timestamp: Date.now()
    });

    return parser;
  } catch (error) {
    if (process.env.DEVELOPMENT_MODE === 'true') {
      console.log(`Could not fetch robots.txt for ${origin}:`, error.message);
    }

    // If we can't fetch robots.txt, assume everything is allowed
    const parser = robotsParser(robotsUrl, '');
    robotsCache.set(origin, {
      parser,
      timestamp: Date.now()
    });

    return parser;
  }
}

async function isAllowedByRobots(url) {
  try {
    const urlObj = new URL(url);
    const origin = urlObj.origin;

    const parser = await getRobotsTxt(origin);
    const userAgent = 'Hugin-Webcrawler';

    return parser.isAllowed(url, userAgent);
  } catch (error) {
    // If we can't parse, assume allowed
    return true;
  }
}

async function getCrawlDelay(url) {
  try {
    const urlObj = new URL(url);
    const origin = urlObj.origin;

    const parser = await getRobotsTxt(origin);
    const userAgent = 'Hugin-Webcrawler';

    return parser.getCrawlDelay(userAgent) || 0;
  } catch (error) {
    return 0;
  }
}

async function getSitemapUrls(origin) {
  try {
    const parser = await getRobotsTxt(origin);
    const sitemaps = parser.getSitemaps();

    if (!sitemaps || sitemaps.length === 0) {
      // Try default sitemap location
      const fetchOrigin = convertOriginForFetch(origin);
      return await fetchSitemap(`${fetchOrigin}/sitemap.xml`, origin);
    }

    // Fetch all sitemaps and combine results
    const allUrls = [];
    for (const sitemapUrl of sitemaps) {
      const urls = await fetchSitemap(sitemapUrl, origin);
      allUrls.push(...urls);
    }

    return allUrls;
  } catch (error) {
    if (process.env.DEVELOPMENT_MODE === 'true') {
      console.log(`Could not fetch sitemap for ${origin}:`, error.message);
    }
    return [];
  }
}

async function fetchSitemap(sitemapUrl, originalOrigin) {
  try {
    // Convert sitemap URL for fetching if needed
    let fetchUrl = sitemapUrl;
    if (process.env.DEVELOPMENT_MODE === 'true' && originalOrigin) {
      try {
        const url = new URL(sitemapUrl);
        const origUrl = new URL(originalOrigin);
        if (url.hostname === origUrl.hostname) {
          fetchUrl = sitemapUrl.replace(origUrl.origin, convertOriginForFetch(origUrl.origin));
        }
      } catch (error) {
        // Use original URL
      }
    }

    const response = await axios.get(fetchUrl, {
      timeout: 10000,
      validateStatus: (status) => status === 200
    });

    if (response.status !== 200) {
      return [];
    }

    const xml = response.data;
    const urls = [];

    // Simple XML parsing - extract <loc> tags
    const locRegex = /<loc>(.*?)<\/loc>/g;
    let match;
    while ((match = locRegex.exec(xml)) !== null) {
      // Convert URLs back to localhost if they're host.docker.internal
      let url = match[1];
      if (process.env.DEVELOPMENT_MODE === 'true' && originalOrigin) {
        url = url.replace('host.docker.internal', new URL(originalOrigin).hostname);
      }
      urls.push(url);
    }

    return urls;
  } catch (error) {
    return [];
  }
}

module.exports = {
  isAllowedByRobots,
  getCrawlDelay,
  getSitemapUrls
};
