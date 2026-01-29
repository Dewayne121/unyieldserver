/**
 * Strength Ratio Calculation Utilities
 *
 * Formula: (Total weight lifted / Bodyweight) * (Reps * 0.1)
 *
 * This replaces the old points-based system with a strength ratio system
 * that normalizes performance relative to bodyweight.
 */

/**
 * Calculate Strength Ratio for a workout
 *
 * @param {Object} params
 * @param {number} params.weightLifted - Total weight lifted in kg (reps * weight per rep)
 * @param {number} params.bodyweight - User's bodyweight in kg
 * @param {number} params.reps - Number of reps
 * @returns {number} Strength ratio score (rounded to 3 decimal places)
 * @throws {Error} If bodyweight is invalid
 */
function calculateStrengthRatio({ weightLifted, bodyweight, reps }) {
  // Validate bodyweight
  if (!bodyweight || bodyweight <= 0) {
    throw new Error('Valid bodyweight required for strength ratio calculation');
  }

  // Validate other inputs - return 0 for invalid inputs
  if (!weightLifted || weightLifted <= 0) {
    return 0;
  }

  if (!reps || reps <= 0) {
    return 0;
  }

  // Base ratio: total weight lifted / bodyweight
  const baseRatio = weightLifted / bodyweight;

  // Rep multiplier: reps * 0.1
  // This discourages single-rep ego lifts and rewards consistent volume
  const repMultiplier = reps * 0.1;

  // Final strength ratio
  const strengthRatio = baseRatio * repMultiplier;

  // Round to 3 decimal places for consistency
  return Math.round(strengthRatio * 1000) / 1000;
}

/**
 * Determine weight class from bodyweight in kg
 *
 * Weight Classes:
 * - W55_64: 55-64 kg
 * - W65_74: 65-74 kg
 * - W75_84: 75-84 kg
 * - W85_94: 85-94 kg
 * - W95_109: 95-109 kg
 * - W110_PLUS: 110+ kg
 * - UNCLASSIFIED: Under 55kg or missing weight
 *
 * @param {number} weightKg - Bodyweight in kg
 * @returns {string} Weight class identifier
 */
function getWeightClass(weightKg) {
  if (!weightKg || weightKg < 55) {
    return 'UNCLASSIFIED';
  }

  if (weightKg >= 55 && weightKg <= 64) {
    return 'W55_64';
  }
  if (weightKg >= 65 && weightKg <= 74) {
    return 'W65_74';
  }
  if (weightKg >= 75 && weightKg <= 84) {
    return 'W75_84';
  }
  if (weightKg >= 85 && weightKg <= 94) {
    return 'W85_94';
  }
  if (weightKg >= 95 && weightKg <= 109) {
    return 'W95_109';
  }
  if (weightKg >= 110) {
    return 'W110_PLUS';
  }

  return 'UNCLASSIFIED';
}

/**
 * Get display label for weight class
 *
 * @param {string} weightClass - Weight class identifier
 * @returns {string} Human-readable label
 */
function getWeightClassLabel(weightClass) {
  const labels = {
    'W55_64': '55-64 kg',
    'W65_74': '65-74 kg',
    'W75_84': '75-84 kg',
    'W85_94': '85-94 kg',
    'W95_109': '95-109 kg',
    'W110_PLUS': '110+ kg',
    'UNCLASSIFIED': 'Unclassified'
  };
  return labels[weightClass] || 'Unknown';
}

/**
 * Format strength ratio for display
 *
 * @param {number} ratio - Strength ratio value
 * @returns {string} Formatted string with 3 decimal places
 */
function formatStrengthRatio(ratio) {
  if (ratio === null || ratio === undefined) {
    return '0.000';
  }
  return ratio.toFixed(3);
}

module.exports = {
  calculateStrengthRatio,
  getWeightClass,
  getWeightClassLabel,
  formatStrengthRatio
};
