import { Router } from 'express';
import db from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';

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

// POST /api/wallet/recharge — demande de rechargement (admin valide manuellement)
router.post('/wallet/recharge', requireAuth, async (req, res) => {
  try {
    const { amount, provider, bpayCode, phoneNumber } = req.body;
    if (!amount || amount < 100) return res.status(400).json({ error: 'AMOUNT_TOO_LOW' });
    if (!['bankily', 'sedad', 'masrivi'].includes(provider)) return res.status(400).json({ error: 'INVALID_PROVIDER' });

    let description = `Rechargement ${provider} — ${amount} MRU`;
    let referenceCode = null;

    if (provider === 'bankily' && bpayCode) {
      description += ` | B-Pay: ${bpayCode}`;
      if (phoneNumber) description += ` | Tél: ${phoneNumber}`;
    }

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
