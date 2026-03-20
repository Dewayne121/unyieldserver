// 1RM Calculation Utilities for Core Lift Leaderboard
// Uses industry-standard formulas for estimating one-rep max from various rep ranges

/**
 * Select appropriate 1RM formula based on rep range
 * - Brzycki: Best for 1-10 reps (most accurate for powerlifting)
 * - Epley: Better for 11-15 reps
 * - Lander: Alternative for very low rep ranges
 */
function calculate1RM({ weight, reps }) {
  if (!weight || !reps || reps <= 0) return 0;
  if (reps === 1) return weight; // Actual 1RM

  // Brzycki Formula: 1RM = weight * 36 / (37 - reps)
  // Most accurate for 1-10 reps, standard in powerlifting
  if (reps <= 10) {
    const estimated1RM = weight * (36 / (37 - reps));
    return Math.round(estimated1RM * 10) / 10;
  }

  // Epley Formula: 1RM = weight * (1 + reps / 30)
  // Better for 11-15 reps
  if (reps <= 15) {
    const estimated1RM = weight * (1 + reps / 30);
    return Math.round(estimated1RM * 10) / 10;
  }

  // Lander Formula: 1RM = weight * 100 / (101.3 - 2.67123 * reps)
  // Alternative for 16+ reps
  const estimated1RM = weight * (100 / (101.3 - 2.67123 * reps));
  return Math.round(estimated1RM * 10) / 10;
}

/**
 * Calculate Wilks Score (strength relative to bodyweight)
 * Used for fair cross-weight-class comparisons
 *
 * @param {Object} params
 * @param {number} params.weightKg - Weight lifted in kg
 * @param {number} params.bodyweightKg - User's bodyweight in kg
 * @returns {number} Wilks score
 *
 * Formula: (weight * 500) / (a + bx + cx^2 + dx^3 + ex^4 + fx^5 + ex^6)
 *
 * Coefficients (simplified, gender-agnostic):
 *   a = -216.0475144
 *   b = 16.2606339
 *   c = -0.002388645
 *   d = -0.00113732
 *   e = 7.01863e-6
 *   f = -1.291e-8
 */
function calculateWilksScore({ weightKg, bodyweightKg }) {
  if (!weightKg || !bodyweightKg || bodyweightKg <= 0) return 0;

  const x = bodyweightKg;
  const a = -216.0475144;
  const b = 16.2606339;
  const c = -0.002388645;
  const d = -0.00113732;
  const e = 7.01863e-6;
  const f = -1.291e-8;

  const denom = a + (b * x) + (c * x * x) + (d * x * x * x) + (e * x * x * x * x * x) + (f * x * x * x * x * x * x);

  return 500 * weightKg / denom;
}

module.exports = {
  calculate1RM,
  calculateWilksScore
};
