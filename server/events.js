/**
 * BordelBox Events Server
 * Gestion des Boss et Sondages
 */

let activeEvent = null;
let eventTimeout = null;
let lastEventTime = 0;
const EVENT_COOLDOWN = 5 * 60 * 1000; // 5 minutes

function startEvent(io, eventData) {
  const now = Date.now();
  if (now - lastEventTime < EVENT_COOLDOWN) {
    const timeLeft = Math.ceil((EVENT_COOLDOWN - (now - lastEventTime)) / 1000);
    return { error: `Veuillez patienter encore ${timeLeft} secondes avant de lancer un autre événement.` };
  }

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
      startTime: now,
      participants: new Set()
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
  if (serializableEvent.participants) serializableEvent.participants = Array.from(serializableEvent.participants);
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

  if (activeEvent.type === 'boss') {
    if (!activeEvent.participants) activeEvent.participants = new Set();
    activeEvent.participants.add(interactionData.userId);

    const damage = Math.floor(Math.random() * 10) + 5;
    activeEvent.currentHp -= damage;

    if (activeEvent.currentHp <= 0) {
      activeEvent.currentHp = 0;
      updated = true;
      const serializableEvent = { ...activeEvent, participants: Array.from(activeEvent.participants) };
      io.emit('event_update', serializableEvent);
      endEvent(io, { reason: 'defeated', participants: Array.from(activeEvent.participants) });
      return { ok: true, damage, defeated: true, eventId: activeEvent.id };
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
    if (serializableEvent.participants) serializableEvent.participants = Array.from(serializableEvent.participants);
    if (serializableEvent.voters) serializableEvent.voters = Array.from(serializableEvent.voters);
    io.emit('event_update', serializableEvent);
  }

  return { ok: true, eventId: activeEvent.id, damage: (interactionData.damage || null) };
}

function endEvent(io, result) {
  if (!activeEvent) return;

  if (eventTimeout) {
    clearTimeout(eventTimeout);
    eventTimeout = null;
  }

  const serializableEvent = { ...activeEvent, result };
  if (serializableEvent.participants) serializableEvent.participants = Array.from(serializableEvent.participants);
  if (serializableEvent.voters) serializableEvent.voters = Array.from(serializableEvent.voters);
  io.emit('event_end', serializableEvent);

  lastEventTime = Date.now();
  activeEvent = null;
}

module.exports = { startEvent, interactEvent, getActiveEvent: () => activeEvent };
