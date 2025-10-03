const express = require('express');
const { Issuer, generators } = require('openid-client');
const router = express.Router();

let client;
const codeVerifiers = new Map();

// Initialize OIDC client
async function initOIDCClient() {
  if (process.env.DEVELOPMENT_MODE === 'true' && process.env.BYPASS_AUTH === 'true') {
    console.log('OIDC client initialization skipped (BYPASS_AUTH enabled in development mode)');
    return null;
  }

  try {
    const issuer = await Issuer.discover(process.env.OIDC_ISSUER);
    client = new issuer.Client({
      client_id: process.env.OIDC_CLIENT_ID,
      client_secret: process.env.OIDC_CLIENT_SECRET,
      redirect_uris: [process.env.OIDC_REDIRECT_URI],
      response_types: ['code']
    });
    console.log('OIDC client initialized');
    return client;
  } catch (error) {
    console.error('Failed to initialize OIDC client:', error);
    if (process.env.DEVELOPMENT_MODE === 'true') {
      console.log('Continuing in development mode without OIDC');
      return null;
    }
    throw error;
  }
}

// Login route
router.get('/login', async (req, res) => {
  if (process.env.DEVELOPMENT_MODE === 'true' && process.env.BYPASS_AUTH === 'true') {
    return res.redirect('/');
  }

  try {
    if (!client) {
      await initOIDCClient();
    }

    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const state = generators.state();

    codeVerifiers.set(state, codeVerifier);

    const authUrl = client.authorizationUrl({
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state
    });

    res.redirect(authUrl);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to initiate login' });
  }
});

// Callback route
router.get('/callback', async (req, res) => {
  if (process.env.DEVELOPMENT_MODE === 'true' && process.env.BYPASS_AUTH === 'true') {
    return res.redirect('/');
  }

  try {
    const params = client.callbackParams(req);
    const state = params.state;
    const codeVerifier = codeVerifiers.get(state);

    if (!codeVerifier) {
      return res.status(400).json({ error: 'Invalid state parameter' });
    }

    const tokenSet = await client.callback(
      process.env.OIDC_REDIRECT_URI,
      params,
      { code_verifier: codeVerifier, state }
    );

    const userinfo = await client.userinfo(tokenSet);

    req.session.user = {
      id: userinfo.sub,
      email: userinfo.email,
      name: userinfo.name
    };

    codeVerifiers.delete(state);

    res.redirect('/');
  } catch (error) {
    console.error('Callback error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Logout route
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// User info route
router.get('/user', (req, res) => {
  if (process.env.DEVELOPMENT_MODE === 'true' && process.env.BYPASS_AUTH === 'true') {
    return res.json({ id: 'dev-user', email: 'dev@example.com', name: 'Dev User' });
  }

  if (req.session && req.session.user) {
    res.json(req.session.user);
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// Initialize OIDC on module load
if (!(process.env.DEVELOPMENT_MODE === 'true' && process.env.BYPASS_AUTH === 'true')) {
  initOIDCClient().catch(console.error);
}

module.exports = router;
