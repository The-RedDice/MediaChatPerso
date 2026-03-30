const fs = require('fs');
let code = fs.readFileSync('server/stats.js', 'utf8');

const replacement = `// --- BUCKSHOT ROULETTE ---
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
    alivePlayers: [], // populated when game starts
    currentTurnIndex: 0,
    magazine: [] // true = live, false = blank
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

function loadMagazine(roulette) {
   // Randomly generate between 2 and 8 bullets total, but ensure at least 1 live and 1 blank if possible (max 4 of each)
   const totalBullets = Math.floor(Math.random() * 5) + 3; // 3 to 7 bullets
   let liveCount = Math.floor(Math.random() * (totalBullets - 1)) + 1; // 1 to total-1
   let blankCount = totalBullets - liveCount;

   const mag = [];
   for (let i = 0; i < liveCount; i++) mag.push(true);
   for (let i = 0; i < blankCount; i++) mag.push(false);

   // Shuffle
   for (let i = mag.length - 1; i > 0; i--) {
       const j = Math.floor(Math.random() * (i + 1));
       [mag[i], mag[j]] = [mag[j], mag[i]];
   }

   roulette.magazine = mag;
   return { liveCount, blankCount };
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
  // Shuffle player order
  roulette.alivePlayers = [...roulette.players].sort(() => Math.random() - 0.5);
  roulette.currentTurnIndex = 0;

  const magStats = loadMagazine(roulette);

  return {
     ok: true,
     players: roulette.alivePlayers,
     turnPlayer: roulette.alivePlayers[0],
     liveCount: magStats.liveCount,
     blankCount: magStats.blankCount
  };
}

function shootRoulette(rouletteId, shooterId, targetId) {
  const roulette = activeRoulettes.get(rouletteId);
  if (!roulette) return { error: 'Partie introuvable.' };
  if (roulette.state !== 'playing') return { error: 'La partie n\\'est pas en cours.' };

  const currentPlayer = roulette.alivePlayers[roulette.currentTurnIndex];
  if (shooterId !== currentPlayer) return { error: 'Ce n\\'est pas ton tour !' };

  if (!roulette.alivePlayers.includes(targetId)) return { error: 'Cible invalide (déjà morte ou inexistante).' };

  if (roulette.magazine.length === 0) {
      loadMagazine(roulette);
  }

  const isLive = roulette.magazine.shift();
  const isSelf = shooterId === targetId;

  let victimDied = false;
  let keepTurn = false;

  if (isLive) {
     // BOOM
     victimDied = true;
     const victimIndex = roulette.alivePlayers.indexOf(targetId);
     roulette.alivePlayers.splice(victimIndex, 1);

     // Adjust turn index if someone before the current player (or the player themselves) died
     if (victimIndex <= roulette.currentTurnIndex) {
         roulette.currentTurnIndex--;
     }
  } else {
     // CLICK
     if (isSelf) {
         keepTurn = true; // Shot self with blank = keep turn
     }
  }

  // Check win condition
  if (roulette.alivePlayers.length === 1) {
      const winner = roulette.alivePlayers[0];
      const totalPot = roulette.players.length * roulette.amount;
      const tax = Math.floor(totalPot * 0.05);
      const payout = totalPot - tax;
      addCoins(winner, payout);
      activeRoulettes.delete(rouletteId);
      saveStats();
      return {
         ok: true,
         state: 'finished',
         isLive,
         isSelf,
         victim: targetId,
         victimDied,
         winner,
         payout,
         tax
      };
  }

  // Propose draw if 2 players left and someone died
  if (victimDied && roulette.alivePlayers.length === 2) {
      roulette.state = 'proposing_draw';
      roulette.drawVotes.clear();
      // Reset turn to the other guy, but wait, let's keep turn index 0 for the remaining 2,
      // they will resume randomly or the next guy. We'll set it to next guy.
      roulette.currentTurnIndex = (roulette.currentTurnIndex + 1) % roulette.alivePlayers.length;
      return {
         ok: true,
         state: 'draw_proposed',
         isLive,
         isSelf,
         victim: targetId,
         victimDied,
         alive: roulette.alivePlayers,
         nextPlayer: roulette.alivePlayers[roulette.currentTurnIndex]
      };
  }

  // Next turn logic
  if (!keepTurn) {
      roulette.currentTurnIndex = (roulette.currentTurnIndex + 1) % roulette.alivePlayers.length;
  }

  // Reload if empty
  let reloaded = false;
  let liveCount = 0;
  let blankCount = 0;
  if (roulette.magazine.length === 0) {
      const magStats = loadMagazine(roulette);
      reloaded = true;
      liveCount = magStats.liveCount;
      blankCount = magStats.blankCount;
  } else {
      liveCount = roulette.magazine.filter(b => b).length;
      blankCount = roulette.magazine.filter(b => !b).length;
  }

  return {
     ok: true,
     state: 'playing',
     isLive,
     isSelf,
     victim: targetId,
     victimDied,
     keepTurn,
     nextPlayer: roulette.alivePlayers[roulette.currentTurnIndex],
     reloaded,
     liveCount,
     blankCount
  };
}

function voteDrawRoulette(rouletteId, userId, vote) {
  const roulette = activeRoulettes.get(rouletteId);
  if (!roulette) return { error: 'Partie introuvable.' };
  if (roulette.state !== 'proposing_draw') return { error: 'Pas de proposition d\\'égalité en cours.' };
  if (!roulette.alivePlayers.includes(userId)) return { error: 'Tu n\\'es pas en vie dans cette partie.' };

  if (vote === false) {
     roulette.state = 'playing';

     // Tell who plays next
     const nextPlayer = roulette.alivePlayers[roulette.currentTurnIndex];

     // Need to tell if reloaded
     let reloaded = false;
     let liveCount = 0;
     let blankCount = 0;
     if (roulette.magazine.length === 0) {
         const magStats = loadMagazine(roulette);
         reloaded = true;
         liveCount = magStats.liveCount;
         blankCount = magStats.blankCount;
     } else {
         liveCount = roulette.magazine.filter(b => b).length;
         blankCount = roulette.magazine.filter(b => !b).length;
     }

     return { ok: true, drawAccepted: false, message: 'Un joueur a refusé l\\'égalité ! La partie reprend.', nextPlayer, reloaded, liveCount, blankCount };
  }

  roulette.drawVotes.add(userId);

  if (roulette.drawVotes.size === roulette.alivePlayers.length) {
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

function getRouletteState(rouletteId) {
   const roulette = activeRoulettes.get(rouletteId);
   if (!roulette) return null;
   return {
       id: rouletteId,
       state: roulette.state,
       alivePlayers: roulette.alivePlayers,
       turnPlayer: roulette.alivePlayers[roulette.currentTurnIndex],
       liveCount: roulette.magazine.filter(b => b).length,
       blankCount: roulette.magazine.filter(b => !b).length
   };
}

module.exports.createRoulette = createRoulette;
module.exports.joinRoulette = joinRoulette;
module.exports.startRoulette = startRoulette;
module.exports.shootRoulette = shootRoulette;
module.exports.voteDrawRoulette = voteDrawRoulette;
module.exports.cancelRoulette = cancelRoulette;
module.exports.getRouletteState = getRouletteState;

// --- ARENA ---`;

// The code before was // --- ROULETTE --- and ending at // --- ARENA ---.
// Let's replace the whole block.
const blockRegex = /\/\/ --- ROULETTE ---[\s\S]*?\/\/ --- ARENA ---/;
code = code.replace(blockRegex, replacement);
fs.writeFileSync('server/stats.js', code);
