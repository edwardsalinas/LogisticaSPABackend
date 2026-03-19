import * as IamService from './iam.service.js';

/**
 * Middleware de Autenticación (IAM)
 * Verifica el JWT enviado en el header Authorization.
 */
export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No authorization token provided' });
    }

    const token = authHeader.split(' ')[1];
    const user = await IamService.verifyToken(token);

    if (!user) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('[IAM Middleware] Authentication error:', error.message || error);
    res.status(401).json({ 
      message: 'Invalid or expired token', 
      error: error.message 
    });
  }
};

/**
 * Middleware de Autorización (RBAC)
 * Verifica si el usuario tiene uno de los roles permitidos.
 */
export const requireRole = (allowedRoles) => {
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
