const prisma = require('../src/prisma');
const { AppError } = require('./errorHandler');

/**
 * Middleware to check if user has admin privileges
 * Requires user to have 'admin' or 'community_support' accolade
 */
const requireAdmin = async (req, res, next) => {
  try {
    // First ensure user is authenticated
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    // Fetch full user with accolades
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    // Check if user has admin privileges
    const hasAdminPrivilege = user.accolades && (
      user.accolades.includes('admin') ||
      user.accolades.includes('community_support')
    );

    if (!hasAdminPrivilege) {
      return next(new AppError('Admin privileges required', 403));
    }

    // Attach full user to request for use in routes
    req.adminUser = user;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to check if user has 'admin' accolade specifically
 * More restrictive than requireAdmin - only 'admin' accolade, not 'community_support'
 */
const requireSuperAdmin = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    // Check if user has 'admin' accolade specifically
    const isSuperAdmin = user.accolades && user.accolades.includes('admin');

    if (!isSuperAdmin) {
      return next(new AppError('Super admin privileges required', 403));
    }

    req.adminUser = user;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Helper to log admin actions
 * Attaches logAdminAction method to response for use in routes
 */
const logAdminAction = (action, targetType, targetIdParam, details) => {
  return async (req, res, next) => {
    // Ensure adminUser is set (requireAdmin must run before this)
    if (!req.adminUser) {
      console.error('logAdminAction: req.adminUser not set. Ensure requireAdmin middleware runs before logAdminAction.');
      return next();
    }

    // Resolve targetId from params if it's a placeholder like ':id'
    let targetId = targetIdParam;
    if (targetIdParam && targetIdParam.startsWith(':')) {
      const paramName = targetIdParam.slice(1);
      targetId = req.params[paramName] || null;
    }

    // Store the action data for logging after the request
    req.adminActionData = {
      adminId: req.adminUser.id,
      adminName: req.adminUser.name,
      action,
      targetType,
      targetId,
      details,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent'),
    };

    // Override res.json to log after response
    const originalJson = res.json;
    res.json = function(data) {
      // Log the action asynchronously (don't wait for it)
      if (req.adminActionData) {
        prisma.adminAction.create({
          data: req.adminActionData
        }).catch(err => {
          console.error('Failed to log admin action:', err);
        });
      }
      return originalJson.call(this, data);
    };

    next();
  };
};

/**
 * Helper to check if a user can perform admin actions
 * Returns true if user has admin or community_support accolade
 */
const hasAdminPrivilege = (user) => {
  return user.accolades && (
    user.accolades.includes('admin') ||
    user.accolades.includes('community_support')
  );
};

/**
 * Helper to check if user is super admin
 * Returns true if user has 'admin' accolade
 */
const isSuperAdmin = (user) => {
  return user.accolades && user.accolades.includes('admin');
};

/**
 * Middleware to check if user has challenge master privileges
 * Requires user to have 'admin' or 'challenge_master' accolade
 */
const requireChallengeMaster = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    // Check if user has challenge master privileges
    const hasChallengeMasterPrivilege = user.accolades && (
      user.accolades.includes('admin') ||
      user.accolades.includes('challenge_master')
    );

    if (!hasChallengeMasterPrivilege) {
      return next(new AppError('Challenge master privileges required', 403));
    }

    req.adminUser = user;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to check if user can moderate challenge submissions
 * Requires user to have 'admin', 'community_support', or 'challenge_master' accolade
 */
const requireChallengeModerator = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required', 401));
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const canModerateChallenges = user.accolades && (
      user.accolades.includes('admin') ||
      user.accolades.includes('community_support') ||
      user.accolades.includes('challenge_master')
    );

    if (!canModerateChallenges) {
      return next(new AppError('Challenge moderation privileges required', 403));
    }

    req.adminUser = user;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Helper to check if user is a challenge master
 * Returns true if user has 'admin' or 'challenge_master' accolade
 */
const isChallengeMaster = (user) => {
  return user.accolades && (
    user.accolades.includes('admin') ||
    user.accolades.includes('challenge_master')
  );
};

module.exports = {
  requireAdmin,
  requireSuperAdmin,
  requireChallengeMaster,
  requireChallengeModerator,
  logAdminAction,
  hasAdminPrivilege,
  isSuperAdmin,
  isChallengeMaster,
};
