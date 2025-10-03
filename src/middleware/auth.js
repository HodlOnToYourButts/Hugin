function requireAuth(req, res, next) {
  // Check if auth bypass is enabled (only works in development mode)
  if (process.env.DEVELOPMENT_MODE === 'true' && process.env.BYPASS_AUTH === 'true') {
    req.user = { id: 'dev-user', email: 'dev@example.com' };
    return next();
  }

  // Check if user is authenticated
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }

  // User not authenticated
  res.status(401).json({ error: 'Authentication required' });
}

function optionalAuth(req, res, next) {
  // Check if auth bypass is enabled (only works in development mode)
  if (process.env.DEVELOPMENT_MODE === 'true' && process.env.BYPASS_AUTH === 'true') {
    req.user = { id: 'dev-user', email: 'dev@example.com' };
    return next();
  }

  // Set user if authenticated, but don't require it
  if (req.session && req.session.user) {
    req.user = req.session.user;
  }

  next();
}

module.exports = {
  requireAuth,
  optionalAuth
};
