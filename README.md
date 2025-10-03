# Hugin

A web crawler with OIDC authentication and search API for integration with Munin.

## Features

- **Web Crawler**: Automatically crawl URLs and linked pages with configurable depth
- **OIDC Authentication**: Secure login with OpenID Connect provider
- **Development Mode**: Bypass authentication and enable detailed logging
- **CouchDB Storage**: Store crawled pages in CouchDB
- **Search API**: RESTful API for searching crawled content
- **Docker Support**: Run in containers with docker-compose

## Quick Start

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- CouchDB running on the development network

### Environment Variables

Copy `.env.dev.hugin` and configure:

- `DEVELOPMENT_MODE`: Enable development logging
- `BYPASS_AUTH`: Skip OIDC authentication (for development)
- `COUCHDB_URL`: CouchDB connection URL
- `OIDC_*`: OIDC provider configuration

### Running Locally

```bash
npm install
npm run dev
```

### Running with Docker

```bash
docker-compose up --build
```

## API Endpoints

### Authentication

- `GET /auth/login` - Initiate OIDC login
- `GET /auth/callback` - OIDC callback
- `GET /auth/logout` - Logout
- `GET /auth/user` - Get current user info

### Crawler

- `POST /api/crawler/submit` - Submit URL for crawling
- `GET /api/crawler/status/:crawlId` - Get crawl job status
- `GET /api/crawler/jobs` - List recent crawl jobs

### Search (for Munin integration)

- `GET /api/search?q=query&domain=example.com&limit=20&offset=0` - Search crawled content
- `GET /api/search/page?url=https://example.com` - Get specific page by URL

## License

AGPL-3.0
