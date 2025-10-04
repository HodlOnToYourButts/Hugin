function requireAuth(req, res, next) {
  // Check if auth bypass is enabled (only works in development mode)
  if (process.env.DEVELOPMENT_MODE === 'true' && process.env.BYPASS_AUTH === 'true') {
    req.user = {
      id: 'dev-user',
      email: 'dev@example.com',
      roles: ['admin'],
      groups: ['developers']
    };
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
    req.user = {
      id: 'dev-user',
      email: 'dev@example.com',
      roles: ['admin'],
      groups: ['developers']
    };
    return next();
  }

  // Set user if authenticated, but don't require it
  if (req.session && req.session.user) {
    req.user = req.session.user;
  }

  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!req.user.roles || !req.user.roles.includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

function requireGroup(group) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!req.user.groups || !req.user.groups.includes(group)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

module.exports = {
  requireAuth,
  optionalAuth,
  requireRole,
  requireGroup
};
