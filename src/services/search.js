const { getDatabase } = require('../db/couchdb');

async function searchContent({ query, domain, limit = 20, offset = 0 }) {
  const db = getDatabase();

  try {
    // Build search selector
    const selector = {
      type: 'page',
      $or: [
        { title: { $regex: `(?i)${escapeRegex(query)}` } },
        { content: { $regex: `(?i)${escapeRegex(query)}` } },
        { metaDescription: { $regex: `(?i)${escapeRegex(query)}` } }
      ]
    };

    // Add domain filter if specified
    if (domain) {
      selector.domain = domain;
    }

    const result = await db.find({
      selector,
      limit: 1000 // Get more results to sort by relevance
    });

    // Calculate relevance scores and format results
    const results = result.docs.map(doc => {
      const score = calculateRelevance(doc, query);

      return {
        url: doc.url,
        title: doc.title,
        domain: doc.domain,
        snippet: doc.nosnippet ? '' : generateSnippet(doc.content, query),
        metaDescription: doc.nosnippet ? '' : doc.metaDescription,
        metaKeywords: doc.metaKeywords,
        metaAuthor: doc.metaAuthor,
        crawledAt: doc.crawledAt,
        score
      };
    });

    // Sort by relevance score
    results.sort((a, b) => b.score - a.score);

    // Apply pagination after sorting
    const paginatedResults = results.slice(offset, offset + limit);

    return {
      query,
      total: results.length,
      limit,
      offset,
      results: paginatedResults
    };
  } catch (error) {
    console.error('Search error:', error);
    throw error;
  }
}

function calculateRelevance(doc, query) {
  let score = 0;
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/);

  // Parse URL for path analysis
  let urlPath = '';
  let isHomePage = false;
  try {
    const urlObj = new URL(doc.url);
    urlPath = urlObj.pathname;
    isHomePage = urlPath === '/' || urlPath === '';
  } catch (error) {
    // Invalid URL
  }

  // Boost homepage significantly if query matches domain/site name
  if (isHomePage) {
    const domain = doc.domain || '';
    const domainName = domain.split('.')[0]; // Get 'sanctum' from 'sanctum.ygg'

    // Check if query matches the domain name
    if (queryLower === domainName.toLowerCase() ||
        queryWords.includes(domainName.toLowerCase())) {
      score += 100; // Huge boost for homepage when searching site name
    } else {
      score += 20; // Moderate boost for homepage in general
    }
  }

  // URL path depth penalty - shorter paths are more important
  const pathDepth = urlPath.split('/').filter(p => p.length > 0).length;
  score -= pathDepth * 2;

  // Exact title match gets huge boost
  if (doc.title && doc.title.toLowerCase() === queryLower) {
    score += 50;
  } else if (doc.title && doc.title.toLowerCase().includes(queryLower)) {
    // Partial title match
    const titleLower = doc.title.toLowerCase();
    // Check if query is a significant word in title (not just substring)
    const titleWords = titleLower.split(/\s+/);
    const queryInTitle = queryWords.filter(qw => titleWords.includes(qw)).length;
    score += queryInTitle * 15;
  }

  // Keywords matches - check for exact keyword match
  if (doc.metaKeywords) {
    const keywords = doc.metaKeywords.toLowerCase().split(',').map(k => k.trim());
    const exactKeywordMatch = keywords.some(k => k === queryLower);
    if (exactKeywordMatch) {
      score += 30;
    } else if (keywords.some(k => k.includes(queryLower))) {
      score += 10;
    }
  }

  // Meta description matches
  if (doc.metaDescription) {
    const descLower = doc.metaDescription.toLowerCase();
    const wordsInDesc = queryWords.filter(qw => descLower.includes(qw)).length;
    score += wordsInDesc * 5;
  }

  // Author matches
  if (doc.metaAuthor && doc.metaAuthor.toLowerCase().includes(queryLower)) {
    score += 5;
  }

  // Content matches (but limit impact to avoid over-weighting)
  if (doc.content) {
    const contentLower = doc.content.toLowerCase();
    const matches = (contentLower.match(new RegExp(escapeRegex(queryLower), 'g')) || []).length;
    // Logarithmic scaling so many matches don't dominate
    score += Math.min(matches, 10) + Math.log(matches + 1) * 2;
  }

  return Math.round(score * 100) / 100; // Round to 2 decimal places
}

function generateSnippet(content, query, snippetLength = 200) {
  if (!content) return '';

  const queryLower = query.toLowerCase();
  const contentLower = content.toLowerCase();
  const index = contentLower.indexOf(queryLower);

  if (index === -1) {
    // Query not found, return beginning of content
    return content.substring(0, snippetLength) + '...';
  }

  // Extract snippet around the query match
  const start = Math.max(0, index - snippetLength / 2);
  const end = Math.min(content.length, index + query.length + snippetLength / 2);

  let snippet = content.substring(start, end);

  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';

  return snippet;
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  searchContent
};
