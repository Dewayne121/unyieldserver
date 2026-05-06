const express = require('express');
const prisma = require('../src/prisma');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/purchases/record — record a purchase from the client
// ---------------------------------------------------------------------------
router.post(
  '/record',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const {
      sku,
      transactionId,
      userId,
      challengeId,
      challenge_id,
      attempts,
      purchaseToken,
      purchaseId,
      transactionDate,
      platform,
      store,
      durationHours,
      multiplier,
    } = req.body;
    if (!sku) {
      return res.status(400).json({ success: false, error: 'sku is required' });
    }

    if (!KNOWN_SKUS.has(sku)) {
      return res.status(400).json({ success: false, error: 'unknown sku' });
    }

    const uid = req.user?.id || userId || null;
    if (!uid) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }

    const txId = transactionId || `purch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const normalizedChallengeId = challengeId || challenge_id || null;
    const normalizedAttempts = Number.isInteger(attempts)
      ? attempts
      : sku === 'com.unyield.extra_attempt'
        ? 1
        : null;
    const metadata = {
      purchaseId: purchaseId || null,
      transactionDate: transactionDate || null,
      durationHours: durationHours || null,
      multiplier: multiplier || null,
    };

    // Create Purchase record (dedup on transactionId)
    try {
      const purchase = await prisma.purchase.create({
        data: {
          userId: uid,
          sku,
          transactionId: txId,
          status: 'completed',
          challengeId: normalizedChallengeId,
          attempts: normalizedAttempts,
          expiresAt: computeExpiry(sku),
          platform: platform || null,
          store: store || null,
          purchaseToken: purchaseToken || null,
          metadata,
        },
      });

      // Also store as analytics event
      try {
        await prisma.analyticsEvent.create({
          data: {
            eventId: txId,
            name: 'purchase_completed',
            category: 'MONETIZATION',
            userId: uid,
            properties: {
              sku,
              transaction_id: txId,
              challenge_id: normalizedChallengeId,
              platform: platform || null,
              store: store || null,
            },
          },
        });
      } catch {}

      return res.json({ success: true, purchase });
    } catch (err) {
      // Duplicate transactionId — idempotent success
      if (err.message?.includes('Unique') || err.code === 'P2002') {
        const purchase = await prisma.purchase.findUnique({
          where: { transactionId: txId },
        });
        return res.json({ success: true, duplicate: true, purchase });
      }
      throw err;
    }
  })
);

// ---------------------------------------------------------------------------
// GET /api/purchases — return purchases for authenticated user
// ---------------------------------------------------------------------------
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const purchases = await prisma.purchase.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    res.json({ success: true, purchases });
  })
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const KNOWN_SKUS = new Set([
  'com.unyield.challenge_entry',
  'com.unyield.frame.silver',
  'com.unyield.frame.gold',
  'com.unyield.frame.elite',
  'com.unyield.frame.champion',
  'com.unyield.rank_highlight',
  'com.unyield.extra_attempt',
  'com.unyield.xpboost.1hr',
  'com.unyield.xpboost.24hr',
]);

function computeExpiry(sku) {
  if (sku === 'com.unyield.rank_highlight') {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  }
  if (sku === 'com.unyield.xpboost.1hr') {
    const d = new Date();
    d.setHours(d.getHours() + 1);
    return d;
  }
  if (sku === 'com.unyield.xpboost.24hr') {
    const d = new Date();
    d.setHours(d.getHours() + 24);
    return d;
  }
  return null;
}

module.exports = router;
