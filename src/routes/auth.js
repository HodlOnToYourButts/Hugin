const express = require('express');
const { URLSearchParams } = require('url');
const crypto = require('crypto');
const router = express.Router();

const codeVerifiers = new Map();

// Convert localhost to host.docker.internal in development mode for internal calls
function getInternalIssuerUrl() {
  let issuerUrl = process.env.OIDC_ISSUER;

  if (process.env.DEVELOPMENT_MODE === 'true') {
    try {
      const url = new URL(issuerUrl);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        url.hostname = 'host.docker.internal';
        return url.toString();
      }
    } catch (error) {
      // Invalid URL, return as-is
    }
  }
  return issuerUrl;
}

// Get OIDC endpoints
function getOidcEndpoints() {
  let externalBaseUrl = process.env.OIDC_ISSUER;
  let internalBaseUrl = getInternalIssuerUrl();

  // Remove trailing slash if present
  externalBaseUrl = externalBaseUrl.replace(/\/$/, '');
  internalBaseUrl = internalBaseUrl.replace(/\/$/, '');

  return {
    issuer: externalBaseUrl,
    authorization_endpoint: `${externalBaseUrl}/auth`,
    token_endpoint: `${internalBaseUrl}/token`,
    userinfo_endpoint: `${internalBaseUrl}/userinfo`,
    end_session_endpoint: `${externalBaseUrl}/logout`
  };
}

// Generate PKCE code verifier and challenge
function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

// Generate state for CSRF protection
function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

// Extract roles from OIDC userinfo
function extractRoles(userInfo) {
  const roles = ['user']; // Default role

  // Check for groups in OIDC userinfo
  if (userInfo.groups && Array.isArray(userInfo.groups)) {
    roles.push(...userInfo.groups);
  }

  // Check for custom role claims
  if (userInfo.roles && Array.isArray(userInfo.roles)) {
    roles.push(...userInfo.roles);
  }

  // Check for single role field
  if (userInfo.role && typeof userInfo.role === 'string') {
    roles.push(userInfo.role);
  }

  // Check for admin claim in various formats
  if (userInfo.is_admin === true || userInfo.admin === true) {
    roles.push('admin');
  }

  return [...new Set(roles)]; // Remove duplicates
}

// Login route
router.get('/login', async (req, res) => {
  if (process.env.DEVELOPMENT_MODE === 'true' && process.env.BYPASS_AUTH === 'true') {
    return res.redirect('/');
  }

  try {
    const endpoints = getOidcEndpoints();

    // Generate state and PKCE for security
    const state = generateState();
    const { codeVerifier, codeChallenge } = generatePKCE();

    // Store state and code verifier in session for later verification
    req.session.oidc_state = state;
    req.session.oidc_code_verifier = codeVerifier;

    // Build authorization URL
    const authParams = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.OIDC_CLIENT_ID,
      redirect_uri: process.env.OIDC_REDIRECT_URI,
      scope: 'openid email profile roles groups',
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    const authUrl = `${endpoints.authorization_endpoint}?${authParams}`;

    // Ensure session is saved before redirecting
    req.session.save((err) => {
      if (err) {
        console.error('Error saving session before OIDC redirect:', err.message);
        return res.status(500).json({ error: 'Session error' });
      }

      // Small delay to ensure session is persisted
      setTimeout(() => {
        res.redirect(authUrl);
      }, 50);
    });
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
    const { code, state } = req.query;

    // If session data is missing, handle race condition
    if (!req.session.oidc_state && state) {
      console.log('Session state missing, waiting for session...');
      await new Promise(resolve => setTimeout(resolve, 100));

      if (!req.session.oidc_state) {
        console.error('Session data still missing after wait');
        req.session.destroy((err) => {
          if (err) console.error('Session destroy error:', err.message);
          return res.redirect('/login');
        });
        return;
      }
    }

    // Verify state parameter for CSRF protection
    if (!state || state !== req.session.oidc_state) {
      console.error('Invalid state parameter - state mismatch');
      return res.status(400).json({ error: 'Invalid state parameter' });
    }

    if (!code) {
      console.error('Missing authorization code');
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    const endpoints = getOidcEndpoints();

    // Wait 3 seconds before token exchange to ensure everything is settled
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Exchange authorization code for tokens
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: process.env.OIDC_REDIRECT_URI,
      client_id: process.env.OIDC_CLIENT_ID,
      client_secret: process.env.OIDC_CLIENT_SECRET,
      code_verifier: req.session.oidc_code_verifier
    });

    const tokenResponse = await fetch(endpoints.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: tokenParams
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      return res.status(400).json({ error: 'Token exchange failed' });
    }

    const tokens = await tokenResponse.json();

    // Get user info
    const userInfoResponse = await fetch(endpoints.userinfo_endpoint, {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Accept': 'application/json'
      }
    });

    if (!userInfoResponse.ok) {
      const errorText = await userInfoResponse.text();
      console.error('UserInfo request failed:', errorText);
      return res.status(400).json({ error: 'UserInfo request failed' });
    }

    const userInfo = await userInfoResponse.json();

    // Store user info in session
    req.session.user = {
      id: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name || userInfo.preferred_username,
      roles: extractRoles(userInfo),
      groups: userInfo.groups || []
    };

    // Clean up temporary session data
    delete req.session.oidc_state;
    delete req.session.oidc_code_verifier;

    console.log('OIDC authentication successful:', {
      userId: userInfo.sub,
      email: userInfo.email
    });

    // Redirect to home page
    res.redirect('/');

  } catch (error) {
    console.error('Callback error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Logout route
router.get('/logout', (req, res) => {
  try {
    const endpoints = getOidcEndpoints();

    // Clear session
    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying session:', err.message);
      }
    });

    // Redirect to OIDC provider logout
    const logoutParams = new URLSearchParams({
      post_logout_redirect_uri: `${req.protocol}://${req.get('host')}/`
    });

    const logoutUrl = `${endpoints.end_session_endpoint}?${logoutParams}`;
    res.redirect(logoutUrl);
  } catch (error) {
    console.error('Error handling logout:', error);
    res.redirect('/');
  }
});

// User info route
router.get('/user', (req, res) => {
  if (process.env.DEVELOPMENT_MODE === 'true' && process.env.BYPASS_AUTH === 'true') {
    return res.json({
      id: 'dev-user',
      email: 'dev@example.com',
      name: 'Dev User',
      roles: ['admin'],
      groups: ['developers']
    });
  }

  if (req.session && req.session.user) {
    res.json(req.session.user);
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

module.exports = router;
