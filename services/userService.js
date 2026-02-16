/**
 * User Service
 * Contains password hashing and user-related utilities
 * Extracted from Mongoose methods for Prisma compatibility
 */

const bcrypt = require('bcryptjs');
const PASSWORD_MIN_LENGTH = Number.parseInt(process.env.PASSWORD_MIN_LENGTH || '10', 10);

// Constants exported from original User model
const REGIONS = [
  'Global',
  'London',
  'Manchester',
  'Birmingham',
  'Leeds',
  'Glasgow',
];

const GOALS = ['Hypertrophy', 'Leanness', 'Performance'];

const ACCOLADES = [
  'admin',
  'community_support',
  'beta',
  'staff',
  'verified_athlete',
  'founding_member',
  'challenge_master',
];

const FITNESS_LEVELS = ['beginner', 'intermediate', 'advanced', 'elite'];

const PROVIDERS = ['email', 'google', 'apple', 'anonymous'];

/**
 * Hash a password using bcrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Hashed password
 */
const hashPassword = async (password) => {
  return bcrypt.hash(password, 12);
};

/**
 * Compare a candidate password with a hashed password
 * @param {string} candidatePassword - Plain text password to check
 * @param {string} hashedPassword - Hashed password to compare against
 * @returns {Promise<boolean>} True if passwords match
 */
const comparePassword = async (candidatePassword, hashedPassword) => {
  return bcrypt.compare(candidatePassword, hashedPassword);
};

/**
 * Validate password strength using a reasonable baseline policy:
 * - Minimum length
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one symbol
 */
const validatePasswordStrength = (password) => {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return {
      valid: false,
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    };
  }

  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  if (!hasUpper || !hasLower || !hasNumber || !hasSymbol) {
    return {
      valid: false,
      message: 'Password must include uppercase, lowercase, number, and symbol',
    };
  }

  return { valid: true, message: 'Password is valid' };
};

/**
 * Calculate user rank based on total points
 * @param {number} totalPoints - User's total points
 * @returns {number} Calculated rank (1-99)
 */
const updateRank = (totalPoints) => {
  return Math.max(1, 100 - Math.floor(totalPoints / 250));
};

/**
 * Validate region
 * @param {string} region - Region to validate
 * @returns {boolean} True if valid
 */
const isValidRegion = (region) => {
  return REGIONS.includes(region);
};

/**
 * Validate goal
 * @param {string} goal - Goal to validate
 * @returns {boolean} True if valid
 */
const isValidGoal = (goal) => {
  return GOALS.includes(goal);
};

/**
 * Validate fitness level
 * @param {string} level - Fitness level to validate
 * @returns {boolean} True if valid
 */
const isValidFitnessLevel = (level) => {
  return FITNESS_LEVELS.includes(level);
};

/**
 * Validate accolade
 * @param {string} accolade - Accolade to validate
 * @returns {boolean} True if valid
 */
const isValidAccolade = (accolade) => {
  return ACCOLADES.includes(accolade);
};

/**
 * Check if user has admin accolade
 * @param {string[]} accolades - Array of user's accolades
 * @returns {boolean} True if user is admin
 */
const isAdmin = (accolades) => {
  return accolades && accolades.includes('admin');
};

module.exports = {
  REGIONS,
  GOALS,
  ACCOLADES,
  FITNESS_LEVELS,
  PROVIDERS,
  hashPassword,
  comparePassword,
  updateRank,
  isValidRegion,
  isValidGoal,
  isValidFitnessLevel,
  isValidAccolade,
  isAdmin,
  validatePasswordStrength,
  PASSWORD_MIN_LENGTH,
};
