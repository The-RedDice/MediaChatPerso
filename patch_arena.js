const fs = require('fs');

let code = fs.readFileSync('server/stats.js', 'utf8');

const replacement = `// --- ARENA ---
const activeArenas = new Map();

const RARITY_MULTIPLIERS = {
  "commun": 1.0,
  "rare": 1.2,
  "epique": 1.5,
  "legendaire": 2.0,
  "mythique": 3.0,
  "transcendant": 4.0
};

function createArenaChallenge(userId, targetId, amount, userItemId) {
  if (!stats[userId] || !stats[targetId]) return { error: 'Utilisateur inconnu.' };
  if (amount < 0) return { error: 'Mise invalide.' };

  if (stats[userId].bordelCoins < amount) return { error: "Tu n'as pas assez de pièces." };
  if (stats[targetId].bordelCoins < amount) return { error: "Ton adversaire n'a pas assez de pièces." };

  ensureInventoryExists(userId);
  const userInv = stats[userId].inventory || {};
  if (!userInv[userItemId] || userInv[userItemId] <= 0) {
    return { error: "Tu ne possèdes pas l'objet sélectionné." };
  }

  const arenaId = \`AR_\${Date.now()}_\${Math.floor(Math.random() * 1000)}\`;
  activeArenas.set(arenaId, {
    creator: userId,
    target: targetId,
    amount: amount,
    creatorItemId: userItemId,
    createdAt: Date.now()
  });

  // Timeout au bout de 60 secondes
  setTimeout(() => {
    if (activeArenas.has(arenaId)) {
      activeArenas.delete(arenaId);
    }
  }, 60 * 1000);

  return { ok: true, arenaId };
}

function acceptArenaChallenge(arenaId, targetId, targetItemId) {
  const arena = activeArenas.get(arenaId);
  if (!arena) return { error: 'Défi introuvable ou expiré.' };
  if (arena.target !== targetId) return { error: "Ce défi ne t'est pas destiné." };

  ensureInventoryExists(arena.creator);
  ensureInventoryExists(targetId);

  const creatorInv = stats[arena.creator].inventory || {};
  const targetInv = stats[targetId].inventory || {};

  if (!creatorInv[arena.creatorItemId] || creatorInv[arena.creatorItemId] <= 0) {
    return { error: "Le créateur ne possède plus son objet." };
  }
  if (!targetInv[targetItemId] || targetInv[targetItemId] <= 0) {
    return { error: "Tu ne possèdes pas l'objet sélectionné." };
  }

  if (!spendCoins(arena.creator, arena.amount)) return { error: "Le créateur n'a plus les pièces requises." };
  if (!spendCoins(targetId, arena.amount)) {
    addCoins(arena.creator, arena.amount);
    return { error: "Tu n'as plus assez de pièces." };
  }

  activeArenas.delete(arenaId);

  // Get item rarities
  const itemsDbResolved = getItemsDb();

  let creatorItemInfo = null;
  let targetItemInfo = null;

  for (const cat in itemsDbResolved) {
    if (itemsDbResolved[cat][arena.creatorItemId]) creatorItemInfo = itemsDbResolved[cat][arena.creatorItemId];
    if (itemsDbResolved[cat][targetItemId]) targetItemInfo = itemsDbResolved[cat][targetItemId];
  }

  const creatorRarity = creatorItemInfo ? (creatorItemInfo.rarity || 'commun') : 'commun';
  const targetRarity = targetItemInfo ? (targetItemInfo.rarity || 'commun') : 'commun';

  const creatorMultiplier = RARITY_MULTIPLIERS[creatorRarity] || 1.0;
  const targetMultiplier = RARITY_MULTIPLIERS[targetRarity] || 1.0;

  const totalWeight = creatorMultiplier + targetMultiplier;
  const creatorWinProb = creatorMultiplier / totalWeight;

  const winner = Math.random() < creatorWinProb ? arena.creator : targetId;
  const loser = winner === arena.creator ? targetId : arena.creator;

  const winnerItemId = winner === arena.creator ? arena.creatorItemId : targetItemId;
  const loserItemId = winner === arena.creator ? targetItemId : arena.creatorItemId;

  const totalPot = arena.amount * 2;
  const tax = Math.floor(totalPot * 0.05);
  const payout = totalPot - tax;

  addCoins(winner, payout);

  let itemStolen = false;
  // 50% chance to steal the item, but check if untradeable first
  let loserItemInfo = winner === arena.creator ? targetItemInfo : creatorItemInfo;
  const isUntradeable = loserItemInfo && loserItemInfo.untradeable;

  if (!isUntradeable && Math.random() < 0.5) {
     if (removeItemFromInventory(loser, loserItemId)) {
         addItemToInventory(winner, loserItemId);
         itemStolen = true;
     }
  }

  saveStats();

  return {
    ok: true,
    winner,
    loser,
    amount: arena.amount,
    payout,
    tax,
    creatorItemInfo,
    targetItemInfo,
    creatorWinProb,
    itemStolen,
    loserItemId
  };
}

function cancelArenaChallenge(arenaId) {
   activeArenas.delete(arenaId);
}

module.exports.createArenaChallenge = createArenaChallenge;
module.exports.acceptArenaChallenge = acceptArenaChallenge;
module.exports.cancelArenaChallenge = cancelArenaChallenge;

// --- CRAFTING ---`;

code = code.replace('// --- CRAFTING ---', replacement);
fs.writeFileSync('server/stats.js', code);
