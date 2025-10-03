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
      limit,
      skip: offset,
      sort: [{ crawledAt: 'desc' }]
    });

    // Calculate relevance scores and format results
    const results = result.docs.map(doc => {
      const score = calculateRelevance(doc, query);

      return {
        url: doc.url,
        title: doc.title,
        domain: doc.domain,
        snippet: generateSnippet(doc.content, query),
        metaDescription: doc.metaDescription,
        crawledAt: doc.crawledAt,
        score
      };
    });

    // Sort by relevance score
    results.sort((a, b) => b.score - a.score);

    return {
      query,
      total: result.docs.length,
      limit,
      offset,
      results
    };
  } catch (error) {
    console.error('Search error:', error);
    throw error;
  }
}

function calculateRelevance(doc, query) {
  let score = 0;
  const queryLower = query.toLowerCase();

  // Title matches are weighted highest
  if (doc.title && doc.title.toLowerCase().includes(queryLower)) {
    score += 10;
  }

  // Meta description matches
  if (doc.metaDescription && doc.metaDescription.toLowerCase().includes(queryLower)) {
    score += 5;
  }

  // Content matches (count occurrences)
  if (doc.content) {
    const contentLower = doc.content.toLowerCase();
    const matches = (contentLower.match(new RegExp(escapeRegex(queryLower), 'g')) || []).length;
    score += matches;
  }

  return score;
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
