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
    const { sku, transactionId, userId, challengeId, attempts } = req.body;
    if (!sku) {
      return res.status(400).json({ success: false, error: 'sku is required' });
    }

    const uid = userId || req.user?.id || null;
    if (!uid) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }

    const txId = transactionId || `purch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Create Purchase record (dedup on transactionId)
    try {
      const purchase = await prisma.purchase.create({
        data: {
          userId: uid,
          sku,
          transactionId: txId,
          status: 'completed',
          challengeId: challengeId || null,
          attempts: attempts || null,
          expiresAt: computeExpiry(sku),
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
            properties: JSON.stringify({ sku, transaction_id: txId }),
          },
        });
      } catch {}

      return res.json({ success: true, purchase });
    } catch (err) {
      // Duplicate transactionId — idempotent success
      if (err.message?.includes('Unique') || err.code === 'P2002') {
        return res.json({ success: true, duplicate: true });
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
