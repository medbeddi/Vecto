import db from '../config/db.js';
import { emitOrderTaken, emitOrderAssigned } from './socket.js';

// Retourne la delivery active (pending, assigned ou admin_queue) pour un client donné
export async function getActiveDelivery(clientId) {
  return db('deliveries')
    .where({ client_id: clientId })
    .whereIn('status', ['pending', 'assigned', 'admin_queue'])
    .orderBy('created_at', 'desc')
    .first();
}

// Crée une nouvelle delivery en attente de livreur
export async function createDelivery(clientId, description = null) {
  const [delivery] = await db('deliveries')
    .insert({ client_id: clientId, status: 'pending', description })
    .returning('*');
  return delivery;
}

// Crée une delivery dans la file du call center (texte WA → admin)
export async function createAdminQueueDelivery(clientId) {
  const [delivery] = await db('deliveries')
    .insert({ client_id: clientId, status: 'admin_queue' })
    .returning('*');
  return delivery;
}

// Passe une admin_queue delivery en pending avec les adresses et l'émet aux livreurs
export async function launchDelivery(deliveryId, { pickupAddress, dropoffAddress, pickupLat, pickupLng, dropoffLat, dropoffLng, price, forwardedAudioUrl }) {
  const delivery = await db('deliveries').where({ id: deliveryId }).first();
  if (!delivery) {
    const err = new Error('Course introuvable');
    err.code = 'DELIVERY_NOT_FOUND';
    throw err;
  }
  if (delivery.status !== 'admin_queue') {
    const err = new Error('La course n\'est pas en attente call center');
    err.code = 'INVALID_STATUS';
    throw err;
  }

  const updateData = {
    status: 'pending',
    pickup_address:  pickupAddress  ?? null,
    dropoff_address: dropoffAddress ?? null,
    pickup_lat:      pickupLat      ?? null,
    pickup_lng:      pickupLng      ?? null,
    dropoff_lat:     dropoffLat     ?? null,
    dropoff_lng:     dropoffLng     ?? null,
    price:           price          ?? null,
  };
  if (forwardedAudioUrl) {
    updateData.initial_media_type = 'audio';
    updateData.initial_media_url  = forwardedAudioUrl;
  }

  const [updated] = await db('deliveries')
    .where({ id: deliveryId })
    .update(updateData)
    .returning('*');

  return updated;
}

// Assignation atomique d'une course à un livreur
export async function acceptDelivery(deliveryId, driverId) {
  return db.transaction(async (trx) => {
    // Verrouillage pessimiste : empêche deux livreurs d'accepter simultanément
    const delivery = await trx('deliveries')
      .where({ id: deliveryId })
      .forUpdate()
      .first();

    if (!delivery) {
      const err = new Error('Course introuvable');
      err.code = 'DELIVERY_NOT_FOUND';
      throw err;
    }

    if (delivery.status !== 'pending') {
      const err = new Error('Course déjà prise ou non disponible');
      err.code = 'ALREADY_TAKEN';
      throw err;
    }

    const [updated] = await trx('deliveries')
      .where({ id: deliveryId })
      .update({
        status: 'assigned',
        driver_id: driverId,
        assigned_at: trx.fn.now(),
      })
      .returning('*');

    await trx('drivers').where({ id: driverId }).update({ status: 'busy' });

    emitOrderTaken(deliveryId);
    emitOrderAssigned(deliveryId);

    return updated;
  });
}

// Met à jour le statut d'une delivery (transitions contrôlées)
export async function updateDeliveryStatus(deliveryId, driverId, newStatus) {
  const ALLOWED_TRANSITIONS = {
    assigned: ['in_progress', 'cancelled'],
    in_progress: ['done', 'cancelled'],
  };

  const delivery = await db('deliveries')
    .where({ id: deliveryId, driver_id: driverId })
    .first();

  if (!delivery) {
    const err = new Error('Course introuvable ou non assignée à ce livreur');
    err.code = 'DELIVERY_NOT_FOUND';
    throw err;
  }

  const allowed = ALLOWED_TRANSITIONS[delivery.status] || [];
  if (!allowed.includes(newStatus)) {
    const err = new Error(`Transition ${delivery.status} → ${newStatus} non autorisée`);
    err.code = 'INVALID_TRANSITION';
    throw err;
  }

  const patch = { status: newStatus };
  if (newStatus === 'done') patch.done_at = db.fn.now();

  // Archivage automatique + libération livreur
  if (newStatus === 'done' || newStatus === 'cancelled') {
    patch.archived_at = db.fn.now();
    await db('drivers').where({ id: driverId }).update({ status: 'available' });
  }

  const [updated] = await db('deliveries')
    .where({ id: deliveryId })
    .update(patch)
    .returning('*');

  return updated;
}
