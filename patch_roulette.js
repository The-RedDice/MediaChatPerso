const fs = require('fs');
let code = fs.readFileSync('server/stats.js', 'utf8');

const replacement = `// --- ROULETTE ---
const activeRoulettes = new Map();

function createRoulette(userId, amount) {
  if (!stats[userId]) return { error: 'Utilisateur inconnu.' };
  if (amount <= 0) return { error: 'Mise invalide.' };
  if (stats[userId].bordelCoins < amount) return { error: "Tu n'as pas assez de pièces." };

  const rouletteId = \`RO_\${Date.now()}_\${Math.floor(Math.random() * 1000)}\`;
  activeRoulettes.set(rouletteId, {
    creator: userId,
    amount: amount,
    players: [userId],
    createdAt: Date.now(),
    state: 'waiting', // waiting, playing, proposing_draw
    drawVotes: new Set(),
    alivePlayers: [] // populated when game starts
  });

  return { ok: true, rouletteId };
}

function joinRoulette(rouletteId, userId) {
  const roulette = activeRoulettes.get(rouletteId);
  if (!roulette) return { error: 'Partie introuvable.' };
  if (roulette.state !== 'waiting') return { error: 'La partie a déjà commencé.' };
  if (roulette.players.includes(userId)) return { error: 'Tu as déjà rejoint cette partie.' };

  if (!stats[userId] || stats[userId].bordelCoins < roulette.amount) {
    return { error: "Tu n'as pas assez de pièces." };
  }

  roulette.players.push(userId);
  return { ok: true, playersCount: roulette.players.length };
}

function startRoulette(rouletteId) {
  const roulette = activeRoulettes.get(rouletteId);
  if (!roulette) return { error: 'Partie introuvable.' };
  if (roulette.state !== 'waiting') return { error: 'La partie a déjà commencé.' };
  if (roulette.players.length < 2) {
    activeRoulettes.delete(rouletteId);
    return { error: 'Pas assez de joueurs pour commencer.' };
  }

  // Deduct coins from everyone
  for (const p of roulette.players) {
    if (!spendCoins(p, roulette.amount)) {
        // If someone doesn't have enough anymore, remove them
        roulette.players = roulette.players.filter(id => id !== p);
    }
  }

  if (roulette.players.length < 2) {
      // Refund remaining
      for (const p of roulette.players) {
         addCoins(p, roulette.amount);
      }
      activeRoulettes.delete(rouletteId);
      return { error: 'Certains joueurs n\\'avaient plus les fonds. Annulation.' };
  }

  roulette.state = 'playing';
  roulette.alivePlayers = [...roulette.players];
  return { ok: true, players: roulette.players };
}

function shootRoulette(rouletteId) {
  const roulette = activeRoulettes.get(rouletteId);
  if (!roulette) return { error: 'Partie introuvable.' };
  if (roulette.state !== 'playing') return { error: 'La partie n\\'est pas en cours.' };

  // Randomly eliminate one player
  const victimIndex = Math.floor(Math.random() * roulette.alivePlayers.length);
  const victim = roulette.alivePlayers[victimIndex];
  roulette.alivePlayers.splice(victimIndex, 1);

  if (roulette.alivePlayers.length === 2) {
      roulette.state = 'proposing_draw';
      roulette.drawVotes.clear();
      return { ok: true, victim, state: 'draw_proposed', alive: roulette.alivePlayers };
  } else if (roulette.alivePlayers.length === 1) {
      const winner = roulette.alivePlayers[0];
      const totalPot = roulette.players.length * roulette.amount;
      const tax = Math.floor(totalPot * 0.05);
      const payout = totalPot - tax;
      addCoins(winner, payout);
      activeRoulettes.delete(rouletteId);
      saveStats();
      return { ok: true, victim, state: 'finished', winner, payout, tax };
  } else {
      return { ok: true, victim, state: 'playing', alive: roulette.alivePlayers };
  }
}

function voteDrawRoulette(rouletteId, userId, vote) {
  const roulette = activeRoulettes.get(rouletteId);
  if (!roulette) return { error: 'Partie introuvable.' };
  if (roulette.state !== 'proposing_draw') return { error: 'Pas de proposition d\\'égalité en cours.' };
  if (!roulette.alivePlayers.includes(userId)) return { error: 'Tu n\\'es pas en vie dans cette partie.' };

  if (vote === false) {
     // Someone declined draw, resume playing
     roulette.state = 'playing';
     return { ok: true, drawAccepted: false, message: 'Un joueur a refusé l\\'égalité ! La partie reprend.' };
  }

  roulette.drawVotes.add(userId);

  if (roulette.drawVotes.size === roulette.alivePlayers.length) {
     // Everyone accepted draw
     const totalPot = roulette.players.length * roulette.amount;
     const tax = Math.floor(totalPot * 0.05);
     const potAfterTax = totalPot - tax;
     const payoutPerPlayer = Math.floor(potAfterTax / roulette.alivePlayers.length);

     for (const p of roulette.alivePlayers) {
         addCoins(p, payoutPerPlayer);
     }
     activeRoulettes.delete(rouletteId);
     saveStats();

     return { ok: true, drawAccepted: true, payout: payoutPerPlayer, players: roulette.alivePlayers };
  }

  return { ok: true, drawAccepted: 'waiting' };
}

function cancelRoulette(rouletteId) {
   const roulette = activeRoulettes.get(rouletteId);
   if (roulette && roulette.state === 'waiting') {
      activeRoulettes.delete(rouletteId);
   }
}

module.exports.createRoulette = createRoulette;
module.exports.joinRoulette = joinRoulette;
module.exports.startRoulette = startRoulette;
module.exports.shootRoulette = shootRoulette;
module.exports.voteDrawRoulette = voteDrawRoulette;
module.exports.cancelRoulette = cancelRoulette;

// --- ARENA ---`;

code = code.replace('// --- ARENA ---', replacement);
fs.writeFileSync('server/stats.js', code);
