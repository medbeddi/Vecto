import { Router } from 'express';
import db from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { processPayment, checkTransaction, isTimeout } from '../services/bpay.js';
import { env } from '../config/env.js';

const router = Router();

// Créer le wallet si absent (appelé automatiquement)
async function ensureWallet(driverId) {
  const existing = await db('wallets').where({ driver_id: driverId }).first();
  if (!existing) {
    await db('wallets').insert({ driver_id: driverId });
  }
  return db('wallets').where({ driver_id: driverId }).first();
}

// GET /api/wallet — solde + dernières transactions
router.get('/wallet', requireAuth, async (req, res) => {
  try {
    const wallet = await ensureWallet(req.driver.id);
    const transactions = await db('wallet_transactions')
      .where({ wallet_id: wallet.id })
      .orderBy('created_at', 'desc')
      .limit(20)
      .select('id', 'amount', 'type', 'description', 'status', 'created_at as createdAt');
    res.json({ balance: parseFloat(wallet.balance), transactions });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/wallet/recharge — rechargement wallet
// Bankily : paiement automatique via B-PAY API si BPAY_ENABLED
// Sedad / Masrivi : demande manuelle (admin valide)
router.post('/wallet/recharge', requireAuth, async (req, res) => {
  try {
    const { amount, provider, phoneNumber, passcode } = req.body;

    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 100 || amount > 1_000_000) {
      return res.status(400).json({ error: 'AMOUNT_INVALID' });
    }
    if (!['bankily', 'sedad', 'masrivi'].includes(provider)) {
      return res.status(400).json({ error: 'INVALID_PROVIDER' });
    }

    // ── Bankily B-PAY automatique ──────────────────────────────────────────
    if (provider === 'bankily') {
      if (!env.BPAY_ENABLED) {
        return res.status(503).json({ error: 'BPAY_NOT_CONFIGURED' });
      }
      if (!phoneNumber || !passcode) {
        return res.status(400).json({ error: 'MISSING_BPAY_FIELDS' });
      }

      const operationId = `VCT_${req.driver.id.replace(/-/g, '').slice(0, 8)}_${Date.now()}`;
      const wallet = await ensureWallet(req.driver.id);

      const [tx] = await db('wallet_transactions')
        .insert({
          wallet_id: wallet.id,
          amount,
          type: 'recharge',
          description: `Rechargement Bankily B-PAY — ${amount} MRU | OpID: ${operationId}`,
          status: 'pending',
        })
        .returning('*');

      try {
        const result = await processPayment({ clientPhone: phoneNumber, passcode, operationId, amount });

        if (result.errorCode === '0') {
          await db('wallets').where({ id: wallet.id }).increment('balance', amount);
          await db('wallet_transactions').where({ id: tx.id }).update({
            status: 'completed',
            description: `Rechargement Bankily B-PAY — ${amount} MRU | TxID: ${result.transactionId}`,
          });
          const updated = await db('wallets').where({ id: wallet.id }).first();
          return res.json({ success: true, transactionId: result.transactionId, balance: parseFloat(updated.balance) });
        }

        await db('wallet_transactions').where({ id: tx.id }).update({ status: 'failed' });
        return res.status(400).json({ error: 'PAYMENT_FAILED', message: result.errorMessage });

      } catch (err) {
        if (isTimeout(err)) {
          // Timeout sur /payment — on vérifie le statut réel
          try {
            const check = await checkTransaction(operationId);
            if (check.status === 'TS') {
              await db('wallets').where({ id: wallet.id }).increment('balance', amount);
              await db('wallet_transactions').where({ id: tx.id }).update({
                status: 'completed',
                description: `Rechargement Bankily B-PAY — ${amount} MRU | TxID: ${check.transactionId} (timeout→TS)`,
              });
              const updated = await db('wallets').where({ id: wallet.id }).first();
              return res.json({ success: true, transactionId: check.transactionId, balance: parseFloat(updated.balance) });
            }
            if (check.status === 'TF') {
              await db('wallet_transactions').where({ id: tx.id }).update({ status: 'failed' });
              return res.status(400).json({ error: 'PAYMENT_FAILED' });
            }
            // TA (ambigu) ou checkTransaction timeout → laissé en pending pour l'admin
            return res.status(202).json({
              error: 'PAYMENT_PENDING',
              operationId,
              message: 'Paiement en cours de vérification. Contactez le support si le montant est débité.',
            });
          } catch {
            return res.status(202).json({ error: 'PAYMENT_PENDING', operationId });
          }
        }
        await db('wallet_transactions').where({ id: tx.id }).update({ status: 'failed' });
        return res.status(500).json({ error: 'SERVER_ERROR' });
      }
    }

    // ── Sedad / Masrivi — validation manuelle par l'admin ──────────────────
    let description = `Rechargement ${provider} — ${amount} MRU`;
    let referenceCode = null;

    if (provider === 'sedad') {
      referenceCode = Math.floor(100000 + Math.random() * 900000).toString();
      description += ` | Réf: ${referenceCode}`;
    }

    const wallet = await ensureWallet(req.driver.id);
    const [tx] = await db('wallet_transactions')
      .insert({
        wallet_id: wallet.id,
        amount,
        type: 'recharge',
        description,
        status: 'pending',
      })
      .returning('*');

    res.json({ transaction: tx, referenceCode, message: 'Demande envoyée. En attente de validation.' });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// GET /api/wallet/bpay-info — retourne le code commerçant B-PAY (pour affichage dans l'app)
router.get('/wallet/bpay-info', requireAuth, (req, res) => {
  res.json({ merchantCode: env.BPAY_MERCHANT_CODE || null, enabled: env.BPAY_ENABLED });
});

// GET /api/deliveries/history — courses terminées du driver
router.get('/deliveries/history', requireAuth, async (req, res) => {
  try {
    const deliveries = await db('deliveries')
      .join('clients', 'deliveries.client_id', 'clients.id')
      .where({ 'deliveries.driver_id': req.driver.id })
      .whereIn('deliveries.status', ['done', 'cancelled'])
      .orderBy('deliveries.created_at', 'desc')
      .limit(50)
      .select(
        'deliveries.id',
        'deliveries.status',
        'deliveries.created_at as createdAt',
        'clients.alias as clientAlias'
      );
    res.json({ deliveries });
  } catch {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

export default router;
