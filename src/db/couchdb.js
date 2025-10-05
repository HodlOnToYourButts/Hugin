const nano = require('nano');

// Build CouchDB URL with credentials
let couchdbUrl = process.env.COUCHDB_URL;
const dbName = process.env.COUCHDB_DATABASE || 'hugin';

// Add credentials to URL
const username = process.env.COUCHDB_USER;
const password = process.env.COUCHDB_PASSWORD;

if (username && password) {
  // Parse the URL and inject credentials
  const urlObj = new URL(couchdbUrl);
  urlObj.username = username;
  urlObj.password = password;
  couchdbUrl = urlObj.toString();
}

const couch = nano(couchdbUrl);
let db;

async function initDatabase() {
  try {
    // Assume database already exists and has been set up by admin
    db = couch.use(dbName);

    // Create indexes for queries
    await createIndexes();

    // Create design documents for views
    await createViews();

    console.log(`Connected to CouchDB database: ${dbName}`);
    return db;
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

async function createIndexes() {
  const indexes = [
    {
      index: {
        fields: ['type', 'submittedBy', 'submittedAt']
      },
      name: 'crawl-jobs-index',
      ddoc: 'crawl-jobs'
    },
    {
      index: {
        fields: ['type', 'url']
      },
      name: 'pages-by-url-index',
      ddoc: 'pages-url'
    },
    {
      index: {
        fields: ['type', 'domain']
      },
      name: 'pages-by-domain-index',
      ddoc: 'pages-domain'
    }
  ];

  for (const indexDef of indexes) {
    try {
      await db.createIndex(indexDef);
      if (process.env.DEVELOPMENT_MODE === 'true') {
        console.log(`Created index: ${indexDef.name}`);
      }
    } catch (error) {
      // Index might already exist, ignore error
      if (process.env.DEVELOPMENT_MODE === 'true') {
        console.log(`Index ${indexDef.name} already exists or error:`, error.message);
      }
    }
  }
}

async function createViews() {
  const designDocs = {
    pages: {
      _id: '_design/pages',
      views: {
        by_url: {
          map: function(doc) {
            if (doc.type === 'page') {
              emit(doc.url, doc);
            }
          }.toString()
        },
        by_domain: {
          map: function(doc) {
            if (doc.type === 'page' && doc.domain) {
              emit(doc.domain, doc);
            }
          }.toString()
        },
        by_crawled_date: {
          map: function(doc) {
            if (doc.type === 'page' && doc.crawledAt) {
              emit(doc.crawledAt, doc);
            }
          }.toString()
        }
      }
    },
    search: {
      _id: '_design/search',
      views: {
        by_content: {
          map: function(doc) {
            if (doc.type === 'page' && doc.content) {
              emit(doc.content, doc);
            }
          }.toString()
        },
        by_title: {
          map: function(doc) {
            if (doc.type === 'page' && doc.title) {
              emit(doc.title, doc);
            }
          }.toString()
        }
      }
    }
  };

  for (const [key, designDoc] of Object.entries(designDocs)) {
    try {
      const existing = await db.get(designDoc._id);
      designDoc._rev = existing._rev;
      await db.insert(designDoc);
    } catch (error) {
      if (error.statusCode === 404) {
        await db.insert(designDoc);
      }
    }
  }
}

function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

module.exports = {
  initDatabase,
  getDatabase
};
