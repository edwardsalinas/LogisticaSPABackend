import supabase from '../config/supabase.js';

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No authorization token provided' });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.error('[AuthMiddleware] Invalid token:', error?.message);
      return res.status(401).json({ message: 'Invalid or expired token', error: error?.message });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('[AuthMiddleware] Internal error during authentication:', error);
    res.status(500).json({ message: 'Internal server error during authentication' });
  }
};

const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const userRole = req.user.user_metadata?.role || 'client';

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ message: 'Forbidden: Insufficient privileges' });
    }

    next();
  };
};

export { requireAuth, requireRole };
