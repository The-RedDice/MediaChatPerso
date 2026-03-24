/**
 * BordelBox Events Server
 * Gestion des Boss et Sondages
 */

let activeEvent = null;
let eventTimeout = null;
let lastEventTime = 0;

// Le cooldown de boss est retiré pour pouvoir spam, mais les récompenses sont limitées
const REWARD_COOLDOWN = 5 * 60 * 1000; // 5 minutes
const userRewardCooldowns = new Map();

function startEvent(io, eventData) {
  const now = Date.now();

  if (activeEvent) {
    return { error: 'Un événement est déjà en cours.' };
  }

  const eventId = `event_${Date.now()}`;

  if (eventData.type === 'boss') {
    activeEvent = {
      id: eventId,
      type: 'boss',
      name: eventData.name || 'Monstre Inconnu',
      hp: eventData.hp || 100,
      currentHp: eventData.hp || 100,
      image: eventData.image,
      greenscreen: eventData.greenscreen || false,
      filter: eventData.filter || 'aucun',
      effect: eventData.effect || 'aucun',
      connectedIds: eventData.connectedIds || [],
      startTime: now,
      participants: new Map()
    };
  } else if (eventData.type === 'sondage') {
    activeEvent = {
      id: eventId,
      type: 'sondage',
      question: eventData.question || 'Question ?',
      choices: eventData.choices || ['Oui', 'Non'],
      votes: new Array((eventData.choices || []).length || 2).fill(0),
      totalVotes: 0,
      voters: new Set(),
      startTime: now
    };
  }

  const serializableEvent = { ...activeEvent };
  if (serializableEvent.participants) serializableEvent.participants = Array.from(serializableEvent.participants.keys());
  if (serializableEvent.voters) serializableEvent.voters = Array.from(serializableEvent.voters);
  io.emit('event_start', serializableEvent);

  const duration = eventData.duration || (eventData.type === 'boss' ? 60000 : 30000);

  eventTimeout = setTimeout(() => {
    endEvent(io, { reason: 'timeout' });
  }, duration);

  return { ok: true, event: activeEvent };
}

function interactEvent(io, interactionData) {
  if (!activeEvent || activeEvent.id !== interactionData.eventId) {
    return { error: 'Événement expiré ou introuvable.' };
  }

  let updated = false;
  let damageDealt = null;

  if (activeEvent.type === 'boss') {
    if (!activeEvent.participants) activeEvent.participants = new Map();

    damageDealt = Math.floor(Math.random() * 10) + 5;
    activeEvent.currentHp -= damageDealt;

    const currentData = activeEvent.participants.get(interactionData.userId) || { username: interactionData.username, damage: 0 };
    currentData.damage += damageDealt;
    activeEvent.participants.set(interactionData.userId, currentData);

    if (activeEvent.currentHp <= 0) {
      activeEvent.currentHp = 0;
      updated = true;
      const serializableEvent = { ...activeEvent, participants: Array.from(activeEvent.participants.keys()) };
      io.emit('event_update', serializableEvent);

      const stats = require('./stats');

      // Calcul de la cagnotte dynamique en fonction des PC connectés
      let totalConnectedPlayers = 1;
      try {
        const { getClientList } = require('./server');
        const clients = getClientList();
        totalConnectedPlayers = clients.length > 0 ? clients.length : 1;
      } catch(e) {
        // Fallback sécurisé
        totalConnectedPlayers = activeEvent.connectedIds.length || 1;
      }
      const totalPrizePool = totalConnectedPlayers * 15;

      let totalDamage = 0;
      for (const pData of activeEvent.participants.values()) {
        totalDamage += pData.damage;
      }

      // Distribution des récompenses en fonction des dégâts
      const participantsStats = [];
      const wonCoins = new Map();

      const now = Date.now();
      for (const [pId, pData] of activeEvent.participants.entries()) {
        const damagePercent = totalDamage > 0 ? (pData.damage / totalDamage) : 0;
        // On arrondit pour avoir des pièces entières
        let reward = Math.round(damagePercent * totalPrizePool);

        // Verification du cooldown de récompense par utilisateur
        const lastReward = userRewardCooldowns.get(pId) || 0;
        if (now - lastReward < REWARD_COOLDOWN) {
          reward = 0; // Pas de récompense s'il a déjà gagné récemment
        }

        if (reward > 0) {
          stats.addCoins(pId, reward);
          wonCoins.set(pId, reward);
          userRewardCooldowns.set(pId, now); // Enregistrer le temps du dernier gain
        }

        // Chance to drop a lootbox
        let gotLootbox = false;
        if (reward > 0 && Math.random() < 0.3) { // 30% chance for participants getting rewards
           stats.addLootbox(pId, 1);
           gotLootbox = true;
        }

        participantsStats.push({
          userId: pId,
          username: pData.username,
          damage: pData.damage,
          percent: Math.round(damagePercent * 100),
          reward: reward,
          gotLootbox: gotLootbox
        });
      }

      // Trier les participants par dégâts décroissants
      participantsStats.sort((a, b) => b.damage - a.damage);
      // Prendre les 3 meilleurs pour le nom "killer" (garder pour compatibilité)
      const top3Names = participantsStats.slice(0, 3).map(p => p.username).join(', ');

      const killerName = top3Names || 'Un héros';

      const eventIdToReturn = activeEvent.id; // Save ID before ending event

      endEvent(io, { reason: 'defeated', killer: killerName, participants: Array.from(activeEvent.participants.keys()), coinsMap: Array.from(wonCoins.entries()) });
      return { ok: true, damage: damageDealt, defeated: true, eventId: eventIdToReturn, rewards: Array.from(wonCoins.entries()), participantsStats, prizePool: totalPrizePool };
    }
    updated = true;
  }
  else if (activeEvent.type === 'sondage') {
    const { choiceIndex, userId } = interactionData;

    if (!activeEvent.voters) activeEvent.voters = new Set();

    if (activeEvent.voters.has(userId)) {
      return { error: 'Tu as déjà voté !' };
    }

    if (activeEvent.choices[choiceIndex] !== undefined) {
      activeEvent.votes[choiceIndex]++;
      activeEvent.totalVotes++;
      activeEvent.voters.add(userId);
      updated = true;
    }
  }

  if (updated) {
    const serializableEvent = { ...activeEvent };
    if (serializableEvent.participants) serializableEvent.participants = Array.from(serializableEvent.participants.keys());
    if (serializableEvent.voters) serializableEvent.voters = Array.from(serializableEvent.voters);
    io.emit('event_update', serializableEvent);
  }

  return { ok: true, eventId: activeEvent.id, damage: damageDealt };
}

function endEvent(io, result) {
  if (!activeEvent) return;

  if (eventTimeout) {
    clearTimeout(eventTimeout);
    eventTimeout = null;
  }

  const serializableEvent = { ...activeEvent, result };
  if (serializableEvent.participants) serializableEvent.participants = Array.from(serializableEvent.participants.keys());
  if (serializableEvent.voters) serializableEvent.voters = Array.from(serializableEvent.voters);
  io.emit('event_end', serializableEvent);

  lastEventTime = Date.now();
  activeEvent = null;
}

module.exports = { startEvent, interactEvent, getActiveEvent: () => activeEvent };
