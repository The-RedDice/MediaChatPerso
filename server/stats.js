/**
 * Gestionnaire de statistiques persistantes pour BordelBox
 */
const fs = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, 'stats.json');

// Charger ou initialiser les stats
let stats = {};

try {
  if (fs.existsSync(STATS_FILE)) {
    const data = fs.readFileSync(STATS_FILE, 'utf8');
    stats = JSON.parse(data);
  }
} catch (err) {
  console.error('[Stats] Erreur lors du chargement des stats:', err);
}

let saveTimeout = null;

/**
 * Sauvegarder les stats sur le disque (version asynchrone débouncée)
 */
function saveStats() {
  if (saveTimeout) return;

  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    try {
      const data = JSON.stringify(stats, null, 2);
      fs.writeFile(STATS_FILE, data, (err) => {
        if (err) {
          console.error('[Stats] Erreur lors de la sauvegarde:', err);
        }
      });
    } catch (err) {
      console.error('[Stats] Erreur lors de la sérialisation des stats:', err);
    }
  }, 1000);
}

/**
 * Incrémenter une statistique d'envoi pour un utilisateur
 * @param {string} userId - L'ID Discord de l'utilisateur
 * @param {string} username - Le pseudo Discord (pour l'affichage)
 * @param {string} type - 'media', 'file' ou 'message'
 */
function checkDailyReset() {
  const now = new Date();
  const todayStr = now.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

  if (!stats['__daily__']) {
    stats['__daily__'] = {
      date: todayStr,
      data: {}
    };
    saveStats();
    return;
  }

  if (stats['__daily__'].date !== todayStr) {
    // Changement de jour ! On garde les données de la veille
    const oldData = stats['__daily__'].data;

    // On reset pour le nouveau jour
    stats['__daily__'] = {
      date: todayStr,
      data: {}
    };
    saveStats();

    // On distribue les récompenses (qui peuvent faire des appels récursifs)
    distributeDailyRewards(oldData);
  }
}

function addRewardCoins(userId, amount) {
  if (!userId || !stats[userId]) return false;

  if (stats[userId].bordelCoins === undefined) {
    stats[userId].bordelCoins = stats[userId].reputation || 0;
    delete stats[userId].reputation;
  }

  stats[userId].bordelCoins += amount;

  if (stats[userId].bordelCoins < 0) {
    stats[userId].bordelCoins = 0;
  }

  saveStats();
  return true;
}

function distributeDailyRewards(dailyData) {
  if (!dailyData) return;

  const categories = ['media', 'coins', 'fishes', 'slots'];

  categories.forEach(cat => {
    // Extraire les scores de tous les utilisateurs pour cette catégorie
    const scores = [];
    for (const userId in dailyData) {
      if (dailyData[userId][cat]) {
        scores.push({ userId, score: dailyData[userId][cat] });
      }
    }

    // Trier par score décroissant
    scores.sort((a, b) => b.score - a.score);

    // Prendre le top 3
    const top3 = scores.slice(0, 3);

    top3.forEach((user, index) => {
      let coinsReward = 0;
      let lootboxReward = 0;

      if (index === 0) {
        coinsReward = 50;
        lootboxReward = 1;
      } else if (index === 1) {
        coinsReward = 25;
      } else if (index === 2) {
        coinsReward = 10;
      }

      if (coinsReward > 0 || lootboxReward > 0) {
        if (!stats[user.userId]) return; // Sécurité

        addRewardCoins(user.userId, coinsReward);
        if (lootboxReward > 0) {
          addLootbox(user.userId, lootboxReward);
        }

        // Ajouter une notification pour le bot Discord
        if (!stats[user.userId].notifications) {
          stats[user.userId].notifications = [];
        }

        let catName = cat;
        if (cat === 'media') catName = 'Médias envoyés';
        if (cat === 'coins') catName = 'BordelCoins gagnés';
        if (cat === 'fishes') catName = 'Poissons pêchés';
        if (cat === 'slots') catName = 'Machines à sous jouées';

        stats[user.userId].notifications.push({
          type: 'daily_reward',
          rank: index + 1,
          category: catName,
          score: user.score,
          coins: coinsReward,
          lootbox: lootboxReward
        });
      }
    });
  });
}

function recordDailyAction(userId, category, amount = 1) {
  if (!userId) return;
  checkDailyReset();

  if (!stats['__daily__'].data[userId]) {
    stats['__daily__'].data[userId] = {
      media: 0,
      coins: 0,
      fishes: 0,
      slots: 0
    };
  }

  stats['__daily__'].data[userId][category] = (stats['__daily__'].data[userId][category] || 0) + amount;
}


function recordAction(userId, username, type) {
  if (!userId) return; // Si pas d'ID, on ne peut pas track de façon fiable

  checkDailyReset();

  if (!stats[userId]) {
    stats[userId] = {
      username: (username && username !== 'undefined') ? username : 'Unknown',
      mediaCount: 0,
      fileCount: 0,
      messageCount: 0,
      totalCount: 0,
      firstAction: Date.now(),
      lastAction: Date.now(),
      bordelCoins: 0,
      votesGiven: {}
    };
  } else {
    // Mettre à jour le pseudo s'il a changé et est valide
    if (username && username !== 'undefined') {
      stats[userId].username = username;
    }
    // Retrocompatibilité : si firstAction n'existe pas, on l'initialise
    if (!stats[userId].firstAction) {
      stats[userId].firstAction = stats[userId].lastAction || Date.now();
    }
    // Rétrocompatibilité : migration reputation -> bordelCoins
    if (stats[userId].reputation !== undefined) {
      stats[userId].bordelCoins = stats[userId].reputation;
      delete stats[userId].reputation;
    }

    // Empêcher les BordelCoins d'être négatifs (suite à l'ancien système de réputation)
    if (stats[userId].bordelCoins < 0) {
      stats[userId].bordelCoins = 0;
    }
  }

  if (type === 'media') {
    stats[userId].mediaCount++;
    recordDailyAction(userId, 'media', 1);
  } else if (type === 'file') {
    stats[userId].fileCount++;
    recordDailyAction(userId, 'media', 1);
  } else if (type === 'message') {
    stats[userId].messageCount++;
  }

  stats[userId].totalCount++;
  stats[userId].lastAction = Date.now();

  // Sauvegarde à chaque action, ce n'est pas idéal en perf pour des milliers d'appels/s
  // mais pour ce type de bot, c'est suffisant et ça garantit la persistance.
  saveStats();
}

/**
 * Incrémenter la statistique de "skip" (flop) pour un utilisateur
 * @param {string} userId - L'ID Discord de l'utilisateur
 */
function recordSkip(userId) {
  if (!userId || !stats[userId]) return;

  checkDailyReset();

  if (typeof stats[userId].skippedCount !== 'number') {
    stats[userId].skippedCount = 0;
  }

  stats[userId].skippedCount++;
  // We keep skippedCount for legacy, but we stop recording daily action for flops.
  saveStats();
}

/**
 * Obtenir les stats d'un utilisateur
 */
function getUserStats(userId) {
  if (stats[userId] && stats[userId].bordelCoins < 0) {
    stats[userId].bordelCoins = 0;
    saveStats();
  }
  return stats[userId] || null;
}

/**
 * Mettre à jour la réputation d'un utilisateur (géré avec les votes)
 * @param {string} targetId - ID de l'utilisateur qui reçoit la réputation
 * @param {string} targetUsername - Pseudo de l'utilisateur
 * @param {number} value - Valeur du vote (1 ou -1)
 * @param {string} voterId - ID de l'utilisateur qui vote
 * @param {string} messageId - ID du message Discord lié au média
 * @returns {object|null} - { success, newScore, message } ou null si échec/déjà voté
 */
function updateReputation(targetId, targetUsername, value, voterId, messageId) {
  if (!targetId || !voterId || !messageId) return { success: false, message: 'Paramètres invalides' };

  // Assurer que le votant existe dans les stats pour traquer son vote
  if (!stats[voterId]) {
    stats[voterId] = {
      username: 'Unknown',
      mediaCount: 0, fileCount: 0, messageCount: 0, totalCount: 0,
      lastAction: Date.now(),
      bordelCoins: 0,
      votesGiven: {}
    };
  } else {
    if (!stats[voterId].votesGiven) stats[voterId].votesGiven = {};
    if (stats[voterId].reputation !== undefined) {
      stats[voterId].bordelCoins = stats[voterId].reputation;
      delete stats[voterId].reputation;
    }
  }

  // Vérifier si l'utilisateur a déjà voté pour ce message
  if (stats[voterId].votesGiven[messageId]) {
    return { success: false, message: 'Tu as déjà voté pour ce message.' };
  }

  // Assurer que le receveur existe
  if (!stats[targetId]) {
    stats[targetId] = {
      username: (targetUsername && targetUsername !== 'undefined') ? targetUsername : 'Unknown',
      mediaCount: 0, fileCount: 0, messageCount: 0, totalCount: 0,
      lastAction: Date.now(),
      bordelCoins: 0,
      votesGiven: {}
    };
  } else {
    if (targetUsername && targetUsername !== 'undefined') {
      stats[targetId].username = targetUsername;
    }
    if (stats[targetId].reputation !== undefined) {
      stats[targetId].bordelCoins = stats[targetId].reputation;
      delete stats[targetId].reputation;
    }
    if (typeof stats[targetId].bordelCoins !== 'number') {
      stats[targetId].bordelCoins = 0;
    }
  }

  // Appliquer le vote
  stats[voterId].votesGiven[messageId] = value;

  let coinsToAdd = value;

  if (coinsToAdd > 0) {
    const bonus = getCoinBonus(targetId);
    if (bonus > 0) {
       // Probabilistic bonus for small amounts (like 1 coin)
       const bonusAmount = coinsToAdd * bonus;
       const guaranteedBonus = Math.floor(bonusAmount);
       const probBonus = bonusAmount - guaranteedBonus;

       coinsToAdd += guaranteedBonus;
       if (Math.random() < probBonus) {
         coinsToAdd += 1;
       }
    }
  }

  stats[targetId].bordelCoins += coinsToAdd;

  if (coinsToAdd > 0) {
     recordDailyAction(targetId, 'coins', coinsToAdd);
  }

  // Empêcher les BordelCoins d'être négatifs
  if (stats[targetId].bordelCoins < 0) {
    stats[targetId].bordelCoins = 0;
  }

  saveStats();

  return { success: true, newScore: stats[targetId].bordelCoins };
}

/**
 * Déduire des BordelCoins d'un utilisateur
 * @returns {boolean} true si succès, false si fonds insuffisants
 */
function spendCoins(userId, amount) {
  if (!stats[userId] || stats[userId].bordelCoins === undefined) {
    if (stats[userId] && stats[userId].reputation !== undefined) {
      stats[userId].bordelCoins = stats[userId].reputation;
      delete stats[userId].reputation;
    } else {
      return false;
    }
  }

  if (stats[userId].bordelCoins >= amount) {
    stats[userId].bordelCoins -= amount;
    saveStats();
    return true;
  }
  return false;
}

/**
 * Ajouter des BordelCoins à un utilisateur
 */
function addCoins(userId, amount) {
  if (!userId || !stats[userId]) return false;

  if (stats[userId].bordelCoins === undefined) {
    stats[userId].bordelCoins = stats[userId].reputation || 0;
    delete stats[userId].reputation;
  }

  let coinsToAdd = amount;
  if (coinsToAdd > 0) {
    recordDailyAction(userId, 'coins', coinsToAdd);
    const bonus = getCoinBonus(userId);
    if (bonus > 0) {
       const bonusAmount = coinsToAdd * bonus;
       const guaranteedBonus = Math.floor(bonusAmount);
       const probBonus = bonusAmount - guaranteedBonus;

       coinsToAdd += guaranteedBonus;
       if (Math.random() < probBonus) {
         coinsToAdd += 1;
       }
    }
  }

  stats[userId].bordelCoins += coinsToAdd;

  if (stats[userId].bordelCoins < 0) {
    stats[userId].bordelCoins = 0;
  }

  saveStats();
  return true;
}

/**
 * Ajouter des éléments débloqués au profil de l'utilisateur
 */
function unlockStyleItem(userId, type, itemValue) {
  if (!stats[userId]) return false;

  if (!stats[userId].unlockedStyles) {
    stats[userId].unlockedStyles = {
      font: [],
      animation: [],
      effect: []
    };
  }

  if (!stats[userId].unlockedStyles[type]) {
    stats[userId].unlockedStyles[type] = [];
  }

  if (!stats[userId].unlockedStyles[type].includes(itemValue)) {
    stats[userId].unlockedStyles[type].push(itemValue);
    saveStats();
  }
  return true;
}

/**
 * Récupérer les éléments débloqués
 */
function getUnlockedStyles(userId) {
  if (!stats[userId]) return { font: [], animation: [], effect: [] };
  return stats[userId].unlockedStyles || { font: [], animation: [], effect: [] };
}

/**
 * Obtenir le top N des utilisateurs
 * @param {string} type - 'media' ou 'flop' ou 'rep'
 * @param {number} limit - Nombre de résultats maximum
 */
function getLeaderboard(type = 'media', limit = 10, period = 'global') {
  checkDailyReset();

  if (period === 'daily') {
    const dailyData = stats['__daily__']?.data || {};
    const users = [];

    for (const userId in dailyData) {
      if (userId === '__global__' || userId === '__daily__') continue;

      const userObj = {
        userId,
        username: stats[userId]?.username || 'Unknown',
        avatar: stats[userId]?.avatar || null,
        score: dailyData[userId][type] || 0
      };

      if (userObj.score > 0) {
        users.push(userObj);
      }
    }

    return users.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // Global leaderboard
  return Object.entries(stats)
    .filter(([userId]) => userId !== '__global__' && userId !== '__daily__')
    .map(([userId, data]) => ({ userId, ...data }))
    .sort((a, b) => {
      if (type === 'coins') {
        const aCoins = a.bordelCoins !== undefined ? a.bordelCoins : (a.reputation || 0);
        const bCoins = b.bordelCoins !== undefined ? b.bordelCoins : (b.reputation || 0);
        return bCoins - aCoins;
      } else if (type === 'fishes') {
        const aFishes = a.fishesCaught || 0;
        const bFishes = b.fishesCaught || 0;
        return bFishes - aFishes;
      } else if (type === 'slots') {
        const aSlots = a.slotsPlayed || 0;
        const bSlots = b.slotsPlayed || 0;
        return bSlots - aSlots;
      } else {
        // type === 'media'
        const aMedia = (a.mediaCount || 0) + (a.fileCount || 0);
        const bMedia = (b.mediaCount || 0) + (b.fileCount || 0);
        return bMedia - aMedia;
      }
    })
    .filter(u => {
      if (type === 'coins') return (u.bordelCoins || u.reputation || 0) > 0;
      if (type === 'fishes') return (u.fishesCaught || 0) > 0;
      if (type === 'slots') return (u.slotsPlayed || 0) > 0;
      return (u.mediaCount || 0) + (u.fileCount || 0) > 0;
    })
    .slice(0, limit);
}

function getNotifications(userId) {
  if (!stats[userId] || !stats[userId].notifications || stats[userId].notifications.length === 0) {
    return [];
  }
  const notifs = [...stats[userId].notifications];
  stats[userId].notifications = []; // Clear
  saveStats();
  return notifs;
}

/**
 * Enregistrer le profil (style) d'un utilisateur
 */
function saveUserProfile(userId, username, profileData) {
  if (!userId) return;
  if (!stats[userId]) {
    stats[userId] = {
      username: (username && username !== 'undefined') ? username : 'Unknown',
      mediaCount: 0,
      fileCount: 0,
      messageCount: 0,
      totalCount: 0,
      lastAction: Date.now(),
      bordelCoins: 0,
      votesGiven: {}
    };
  } else {
    if (username && username !== 'undefined') {
      stats[userId].username = username;
    }
    if (stats[userId].reputation !== undefined) {
      stats[userId].bordelCoins = stats[userId].reputation;
      delete stats[userId].reputation;
    }
  }

  stats[userId].profile = profileData;
  saveStats();
}

/**
 * Obtenir le profil (style) d'un utilisateur
 */
function getUserProfile(userId) {
  return (stats[userId] && stats[userId].profile) ? stats[userId].profile : null;
}

module.exports = {
  recordAction,
  recordSkip,
  getUserStats,
  getLeaderboard,
  saveUserProfile,
  getUserProfile,
  updateReputation,
  spendCoins,
  addCoins,
  unlockStyleItem,
  getUnlockedStyles,
  getNotifications
};

/** --- SYSTÈME D'INVENTAIRE ET DE LOOTBOXES --- **/

// Chargement des items depuis items.json
let itemsDb = {};
try {
  const itemsPath = path.join(__dirname, 'items.json');
  if (fs.existsSync(itemsPath)) {
    itemsDb = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
  }
} catch(err) {
  console.error('[Stats] Impossible de charger items.json', err);
}

const RARITY_WEIGHTS = {
  "commun": 6000,     // 60%
  "rare": 2500,       // 25%
  "epique": 1000,     // 10%
  "legendaire": 400,  // 4%
  "mythique": 70,     // 0.7%
  "transcendant": 30  // 0.3%
};

const PROCEDURAL_PREFIXES = ["Ancien", "Maudit", "Béni", "Légendaire", "Oublié", "Divin", "Corrompu", "Céleste", "Éthéré", "Sombre"];
const PROCEDURAL_NOUNS = ["Relique", "Artefact", "Joyau", "Fragments", "Essence", "Grimoire", "Talisman", "Sceptre", "Épée", "Couronne"];
const PROCEDURAL_SUFFIXES = ["du Vide", "du Chaos", "de la Lumière", "des Anciens", "de l'Infini", "du Temps", "des Abysses", "de l'Aube", "du Crépuscule", "des Âmes"];

function generateProceduralItem(userId, username) {
  // Global counter for transcendant items
  if (!stats['__global__']) {
    stats['__global__'] = { transcendantCount: 0, proceduralItems: {} };
  }
  if (typeof stats['__global__'].transcendantCount !== 'number') {
    stats['__global__'].transcendantCount = 0;
  }
  if (!stats['__global__'].proceduralItems) {
    stats['__global__'].proceduralItems = {};
  }

  stats['__global__'].transcendantCount++;
  const serial = stats['__global__'].transcendantCount;

  const prefix = PROCEDURAL_PREFIXES[Math.floor(Math.random() * PROCEDURAL_PREFIXES.length)];
  const noun = PROCEDURAL_NOUNS[Math.floor(Math.random() * PROCEDURAL_NOUNS.length)];
  const suffix = PROCEDURAL_SUFFIXES[Math.floor(Math.random() * PROCEDURAL_SUFFIXES.length)];
  const name = `${prefix} ${noun} ${suffix} #${serial}`;

  // Randomize category (titles or badges are best for procedural items)
  const category = Math.random() > 0.5 ? 'titles' : 'badges';
  const id = `PROC_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  let item = {
    id: id,
    name: name,
    rarity: "transcendant",
    category: category,
    serial: serial,
    originalOwnerId: userId,
    originalOwnerName: username || "Inconnu",
    obtainedAt: Date.now()
  };

  if (category === 'badges') {
    const emojis = ["🔥", "✨", "🌟", "👁️", "🌌", "⚡", "🔮", "💎", "🐉", "🔱"];
    item.emoji = emojis[Math.floor(Math.random() * emojis.length)];
    // Random bonus between 30% and 100% for transcendant badges
    const bonusPct = 30 + Math.floor(Math.random() * 71);
    item.bonus = bonusPct / 100.0;
    item.name += ` (+${bonusPct}%)`;
  }

  return item;
}

function getCoinBonus(userId) {
  if (!stats[userId] || !stats[userId].equippedBadge) return 0;

  const badgeId = stats[userId].equippedBadge;

  // Check static DB
  if (itemsDb.badges && itemsDb.badges[badgeId] && itemsDb.badges[badgeId].bonus) {
    return itemsDb.badges[badgeId].bonus;
  }

  // Check procedural DB
  if (stats[userId].proceduralItems && stats[userId].proceduralItems[badgeId] && stats[userId].proceduralItems[badgeId].bonus) {
    return stats[userId].proceduralItems[badgeId].bonus;
  }

  return 0;
}

function ensureInventoryExists(userId) {
  if (!stats[userId]) return;
  if (!stats[userId].inventory) stats[userId].inventory = {};
  if (stats[userId].lootboxes === undefined) stats[userId].lootboxes = 0;

  // Migration for old IDs
  const idMap = {
    'T_NOOB': 'T_NOVICE',
    'T_BOSS': 'T_TUEUR_BOSS',
    'T_KING': 'T_ROI_BORDEL',
    'T_GOD': 'T_DIEU',
    'C_RED': 'C_ROUGE_SANG',
    'C_BLUE': 'C_BLEU_OCEAN',
    'C_GOLD': 'C_OR_PUR',
    'C_NEON': 'C_NEON_ROSE',
    'C_RAINBOW': 'C_DEG_ARC_EN_CIEL',
    'C_FIRE': 'C_DEG_FEU',
    'B_SMILE': 'B_SOURIRE',
    'B_STAR': 'B_ETOILE',
    'B_DIAMOND': 'B_DIAMANT',
    'B_CROWN': 'B_COURONNE',
    'B_SKULL': 'B_CRANE_DORE',
    'J_SMALL': 'J_PETIT_SAC',
    'J_MEDIUM': 'J_GRAND_SAC',
    'J_LARGE': 'J_LINGOT',
    'J_MEGA': 'J_TICKET_OR'
  };

  let migrated = false;

  // Migrate inventory items
  for (const [oldId, newId] of Object.entries(idMap)) {
    if (stats[userId].inventory[oldId]) {
      stats[userId].inventory[newId] = (stats[userId].inventory[newId] || 0) + stats[userId].inventory[oldId];
      delete stats[userId].inventory[oldId];
      migrated = true;
    }
  }

  // Migrate equipped items
  if (stats[userId].equippedTitle && idMap[stats[userId].equippedTitle]) {
    stats[userId].equippedTitle = idMap[stats[userId].equippedTitle];
    migrated = true;
  }
  if (stats[userId].equippedBadge && idMap[stats[userId].equippedBadge]) {
    stats[userId].equippedBadge = idMap[stats[userId].equippedBadge];
    migrated = true;
  }
  if (stats[userId].equippedColor && idMap[stats[userId].equippedColor]) {
    stats[userId].equippedColor = idMap[stats[userId].equippedColor];
    migrated = true;
  }

  if (migrated) {
    saveStats();
  }
}

function addLootbox(userId, amount = 1) {
  if (!stats[userId]) return false;
  ensureInventoryExists(userId);
  stats[userId].lootboxes += amount;
  saveStats();
  return true;
}

function getInventory(userId) {
  if (!stats[userId]) return { items: {}, lootboxes: 0, equipped: {} };
  ensureInventoryExists(userId);
  return {
    items: stats[userId].inventory,
    lootboxes: stats[userId].lootboxes,
    equipped: {
      title: stats[userId].equippedTitle || null,
      badge: stats[userId].equippedBadge || null,
      color: stats[userId].equippedColor || null
    }
  };
}

function addItemToInventory(userId, itemId) {
  if (!stats[userId]) return;
  ensureInventoryExists(userId);
  if (!stats[userId].inventory[itemId]) {
    stats[userId].inventory[itemId] = 0;
  }
  stats[userId].inventory[itemId]++;
  saveStats();
}

function removeItemFromInventory(userId, itemId) {
  if (!stats[userId]) return false;
  ensureInventoryExists(userId);
  if (stats[userId].inventory[itemId] > 0) {
    stats[userId].inventory[itemId]--;
    if (stats[userId].inventory[itemId] === 0) {
      delete stats[userId].inventory[itemId];
    }

    // Si l'objet était équipé, on le déséquipe
    if (stats[userId].equippedTitle === itemId) stats[userId].equippedTitle = null;
    if (stats[userId].equippedBadge === itemId) stats[userId].equippedBadge = null;
    if (stats[userId].equippedColor === itemId) stats[userId].equippedColor = null;

    saveStats();
    return true;
  }
  return false;
}

function openLootbox(userId) {
  if (!stats[userId]) return { error: "Utilisateur inconnu." };
  ensureInventoryExists(userId);

  if (stats[userId].lootboxes <= 0) {
    return { error: "Tu n'as aucune lootbox." };
  }

  stats[userId].lootboxes--;

  // Aplatir tous les items dans un tableau
  const allItems = [];
  for (const category in itemsDb) {
    for (const itemId in itemsDb[category]) {
      const item = itemsDb[category][itemId];
      item.id = itemId;
      item.category = category;
      allItems.push(item);
    }
  }

  if (allItems.length === 0) return { error: "Aucun objet disponible." };

  let wonItem = null;

  // Decide rarity first to see if we hit 'transcendant'
  let totalWeightRarity = 0;
  for (const r in RARITY_WEIGHTS) {
    totalWeightRarity += RARITY_WEIGHTS[r];
  }
  let randomRarityVal = Math.floor(Math.random() * totalWeightRarity);
  let chosenRarity = "commun";
  for (const r in RARITY_WEIGHTS) {
    randomRarityVal -= RARITY_WEIGHTS[r];
    if (randomRarityVal < 0) {
      chosenRarity = r;
      break;
    }
  }

  if (chosenRarity === "transcendant") {
    // Generate a unique procedural item
    wonItem = generateProceduralItem(userId, stats[userId].username);

    // Save it to the global procedural DB so it can be equipped and traded
    stats['__global__'].proceduralItems[wonItem.id] = wonItem;
  } else {
    // Filter items by chosen rarity
    const rarityItems = allItems.filter(i => i.rarity === chosenRarity);
    if (rarityItems.length > 0) {
      wonItem = rarityItems[Math.floor(Math.random() * rarityItems.length)];
    } else {
      wonItem = allItems[Math.floor(Math.random() * allItems.length)]; // Fallback
    }
  }

  // Si c'est un jackpot, on donne l'argent direct
  if (wonItem.category === 'jackpots') {
    addCoins(userId, wonItem.reward);
  } else {
    addItemToInventory(userId, wonItem.id);
  }

  saveStats();
  return { ok: true, item: wonItem };
}

function equipItem(userId, itemId) {
  if (!stats[userId]) return { error: "Utilisateur inconnu." };
  ensureInventoryExists(userId);

  if (!stats[userId].inventory[itemId] || stats[userId].inventory[itemId] <= 0) {
    return { error: "Tu ne possèdes pas cet objet." };
  }

  // Retrouver la catégorie
  let category = null;
  for (const cat in itemsDb) {
    if (itemsDb[cat][itemId]) {
      category = cat;
      break;
    }
  }

  // Check if it's a procedural item
  if (!category && stats['__global__'] && stats['__global__'].proceduralItems && stats['__global__'].proceduralItems[itemId]) {
    category = stats['__global__'].proceduralItems[itemId].category;
  } else if (!category && stats[userId] && stats[userId].proceduralItems && stats[userId].proceduralItems[itemId]) {
    // Fallback for old procedural items (pre-patch)
    category = stats[userId].proceduralItems[itemId].category;
  }

  if (!category) return { error: "Objet invalide." };

  if (category === 'titles') stats[userId].equippedTitle = itemId;
  else if (category === 'badges') stats[userId].equippedBadge = itemId;
  else if (category === 'colors') stats[userId].equippedColor = itemId;
  else return { error: "Cet objet ne peut pas être équipé." };

  saveStats();
  return { ok: true, type: category };
}

function getItemsDb(userId = null) {
  // Create a merged DB starting with static items
  const mergedDb = JSON.parse(JSON.stringify(itemsDb));

  // Merge global procedural items
  if (stats['__global__'] && stats['__global__'].proceduralItems) {
    for (const procId in stats['__global__'].proceduralItems) {
      const procItem = stats['__global__'].proceduralItems[procId];
      if (!mergedDb[procItem.category]) mergedDb[procItem.category] = {};
      mergedDb[procItem.category][procId] = procItem;
    }
  }

  // Merge legacy user-specific procedural items (pre-patch)
  if (userId && stats[userId] && stats[userId].proceduralItems) {
    for (const procId in stats[userId].proceduralItems) {
      const procItem = stats[userId].proceduralItems[procId];
      if (!mergedDb[procItem.category]) mergedDb[procItem.category] = {};
      mergedDb[procItem.category][procId] = procItem;
    }
  }

  return mergedDb;
}

module.exports.addLootbox = addLootbox;
module.exports.getInventory = getInventory;
module.exports.openLootbox = openLootbox;
module.exports.equipItem = equipItem;
module.exports.getItemsDb = getItemsDb;
module.exports.addItemToInventory = addItemToInventory;
module.exports.removeItemFromInventory = removeItemFromInventory;

/** --- NEW FEATURES --- **/

// Daily Rewards
function claimDaily(userId) {
  if (!stats[userId]) return { error: 'Utilisateur inconnu.' };

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  if (!stats[userId].daily) {
    stats[userId].daily = { lastClaimDate: null, streak: 0 };
  }

  if (stats[userId].daily.lastClaimDate === todayStr) {
    return { error: 'Tu as déjà réclamé ta récompense aujourd\'hui !' };
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  if (stats[userId].daily.lastClaimDate === yesterdayStr) {
    stats[userId].daily.streak++;
  } else {
    stats[userId].daily.streak = 1;
  }

  stats[userId].daily.lastClaimDate = todayStr;

  const baseReward = 30;
  const bonus = (stats[userId].daily.streak - 1) * 5;
  const totalReward = baseReward + bonus;

  addCoins(userId, totalReward);

  let rewards = [`${totalReward} BordelCoins`];

  if (stats[userId].daily.streak % 7 === 0) {
    addLootbox(userId, 1);
    rewards.push('1 Lootbox');
  }

  if (stats[userId].daily.streak === 14) {
    ensureInventoryExists(userId);
    if (!stats[userId].inventory['T_DAILY_14']) {
      addItemToInventory(userId, 'T_DAILY_14');
      rewards.push("Titre exclusif 'L'Assidu'");
    }
  }

  saveStats();

  return { ok: true, streak: stats[userId].daily.streak, rewards };
}

// Collection
function getCollectionProgress(userId) {
  if (!stats[userId]) return { error: "Utilisateur inconnu." };
  ensureInventoryExists(userId);

  const userInv = stats[userId].inventory;
  const categories = ['titles', 'colors', 'badges'];
  let totalItems = 0;
  let userItems = 0;

  let progress = {};

  categories.forEach(cat => {
    let catTotal = 0;
    let catUser = 0;

    for (const itemId in itemsDb[cat]) {
      const item = itemsDb[cat][itemId];
      if (item.rarity !== 'transcendant' && !item.untradeable) { // Only count standard items
        catTotal++;
        totalItems++;
        if (userInv[itemId] && userInv[itemId] > 0) {
          catUser++;
          userItems++;
        }
      }
    }
    progress[cat] = { total: catTotal, user: catUser, pct: catTotal > 0 ? (catUser / catTotal) : 0 };
  });

  const globalPct = totalItems > 0 ? (userItems / totalItems) : 0;

  // Check milestone rewards
  const milestones = [
    { pct: 0.10, id: 'T_NOVICE', coins: 0 },
    { pct: 0.25, id: 'T_COLL_25', coins: 500 },
    { pct: 0.25, id: 'T_PRO', coins: 0 },
    { pct: 0.50, id: 'T_COLL_50', coins: 1500 },
    { pct: 0.50, id: 'T_CHAMPION', coins: 0 },
    { pct: 0.75, id: 'T_COLL_75', coins: 3000 },
    { pct: 0.75, id: 'T_ROI_BORDEL', coins: 0 },
    { pct: 1.00, id: 'T_COLL_100', coins: 10000 }
  ];

  let newRewards = [];
  milestones.forEach(m => {
    if (globalPct >= m.pct && (!userInv[m.id] || userInv[m.id] === 0)) {
      addItemToInventory(userId, m.id);
      if (m.coins > 0) addCoins(userId, m.coins);
      newRewards.push(`${m.id}${m.coins > 0 ? ` + ${m.coins} 💰` : ''}`);
    }
  });

  return {
    ok: true,
    globalPct,
    categories: progress,
    newRewards
  };
}

// Fishing
const FISHING_LOOT_TABLE = [
  { id: 'F_TRASH', weight: 4000 },
  { id: 'F_COD', weight: 3000 },
  { id: 'F_SALMON', weight: 1500 },
  { id: 'F_TUNA', weight: 1000 },
  { id: 'F_SHARK', weight: 400 },
  { id: 'F_KRAKEN', weight: 90 },
  { id: 'LOOTBOX', weight: 10 }
];

function getFishCooldown(rodId) {
  if (!rodId || !itemsDb.rods || !itemsDb.rods[rodId]) return 40; // Base
  return itemsDb.rods[rodId].cooldown || 40;
}

function fish(userId, baitId, rodId) {
  if (!stats[userId]) return { error: 'Utilisateur inconnu.' };
  ensureInventoryExists(userId);

  if (!itemsDb.baits || !itemsDb.baits[baitId]) return { error: 'Appât invalide.' };
  const baitPrice = itemsDb.baits[baitId].price || 0;

  const now = Date.now();
  if (!stats[userId].fishing) stats[userId].fishing = { lastFish: 0 };

  const cooldownSecs = getFishCooldown(rodId);
  const elapsed = (now - stats[userId].fishing.lastFish) / 1000;

  if (elapsed < cooldownSecs) {
    return { error: `Tu dois encore attendre ${Math.ceil(cooldownSecs - elapsed)} secondes.` };
  }

  if (!spendCoins(userId, baitPrice)) {
    return { error: `Il te faut ${baitPrice} BordelCoins pour cet appât.` };
  }

  stats[userId].fishing.lastFish = now;

  // Rarity boost from bait
  let currentLootTable = FISHING_LOOT_TABLE.map(l => ({ ...l }));
  if (baitId === 'BAIT_SHRIMP') {
    // Rare bait: reduces trash, boosts mid-tier and rares slightly
    currentLootTable.find(l => l.id === 'F_TRASH').weight *= 0.6;
    currentLootTable.find(l => l.id === 'F_TUNA').weight *= 1.5;
    currentLootTable.find(l => l.id === 'F_SHARK').weight *= 2.0;
    currentLootTable.find(l => l.id === 'F_KRAKEN').weight *= 2.0;
    currentLootTable.find(l => l.id === 'LOOTBOX').weight *= 1.5;
  } else if (baitId === 'BAIT_SQUID') {
    // Epic bait: drastically reduces trash, greatly boosts rares and lootboxes
    currentLootTable.find(l => l.id === 'F_TRASH').weight *= 0.2;
    currentLootTable.find(l => l.id === 'F_COD').weight *= 0.5;
    currentLootTable.find(l => l.id === 'F_SALMON').weight *= 1.2;
    currentLootTable.find(l => l.id === 'F_TUNA').weight *= 2.5;
    currentLootTable.find(l => l.id === 'F_SHARK').weight *= 4.0;
    currentLootTable.find(l => l.id === 'F_KRAKEN').weight *= 5.0;
    currentLootTable.find(l => l.id === 'LOOTBOX').weight *= 3.0;
  }

  let totalWeight = 0;
  currentLootTable.forEach(l => totalWeight += l.weight);
  let rand = Math.floor(Math.random() * totalWeight);
  let wonLoot = 'F_TRASH';
  for (let l of currentLootTable) {
    rand -= l.weight;
    if (rand < 0) {
      wonLoot = l.id;
      break;
    }
  }

  let result = { ok: true, itemId: wonLoot };
  if (wonLoot === 'LOOTBOX') {
    addLootbox(userId, 1);
    result.item = { name: 'Lootbox Mystère', emoji: '🎁', rarity: 'rare' };
  } else {
    addItemToInventory(userId, wonLoot);
    result.item = itemsDb.fishes[wonLoot];

    // Suivi des poissons attrapés
    if (!stats[userId].fishesCaught) stats[userId].fishesCaught = 0;
    stats[userId].fishesCaught++;
    recordDailyAction(userId, 'fishes', 1);
  }

  checkAchievements(userId);
  saveStats();

  return result;
}

function sellFish(userId, fishId, quantityStr) {
  if (!stats[userId]) return { error: 'Utilisateur inconnu.' };
  ensureInventoryExists(userId);

  const inv = stats[userId].inventory;
  let coinsGained = 0;
  let amountSold = 0;

  if (fishId && fishId !== 'all') {
     if (!itemsDb.fishes[fishId]) return { error: 'Poisson invalide.' };
     const count = inv[fishId] || 0;
     if (count <= 0) return { ok: true, amountSold: 0, coinsGained: 0 };

     let amountToSell = 1;
     if (quantityStr && quantityStr.toLowerCase() === 'tout') {
       amountToSell = count;
     } else if (quantityStr) {
       amountToSell = parseInt(quantityStr, 10);
       if (isNaN(amountToSell) || amountToSell <= 0) return { error: 'Quantité invalide.' };
     }

     if (amountToSell > count) amountToSell = count;

     const value = itemsDb.fishes[fishId].value || 0;
     coinsGained = value * amountToSell;
     amountSold = amountToSell;

     inv[fishId] -= amountToSell;
     if (inv[fishId] <= 0) delete inv[fishId];
  } else {
     // Si fishId est 'all' ou non fourni, vendre tous les poissons
     for (const id in itemsDb.fishes) {
        if (!id.startsWith('F_')) continue; // S'assurer qu'on ne vend que des objets poissons
        const count = inv[id] || 0;
        if (count > 0) {
           const value = itemsDb.fishes[id].value || 0;
           coinsGained += value * count;
           amountSold += count;
           delete inv[id];
        }
     }
  }

  if (amountSold > 0) {
     addCoins(userId, coinsGained);
     saveStats();
  }

  return { ok: true, amountSold, coinsGained };
}

// Slots
const SLOTS_EMOJIS = ['🍒', '🍋', '🍉', '🍇', '🔔', '💎'];
function playSlots(userId, amount) {
  if (!stats[userId]) return { error: 'Utilisateur inconnu.' };
  if (amount <= 0) return { error: 'Mise invalide.' };

  if (!spendCoins(userId, amount)) return { error: 'Fonds insuffisants pour jouer.' };

  const r1 = SLOTS_EMOJIS[Math.floor(Math.random() * SLOTS_EMOJIS.length)];
  const r2 = SLOTS_EMOJIS[Math.floor(Math.random() * SLOTS_EMOJIS.length)];
  const r3 = SLOTS_EMOJIS[Math.floor(Math.random() * SLOTS_EMOJIS.length)];

  let winAmount = 0;
  let isJackpot = false;

  // All 3 matching
  if (r1 === r2 && r2 === r3) {
    if (r1 === '💎') { winAmount = amount * 25; isJackpot = true; }
    else if (r1 === '🔔') winAmount = amount * 15;
    else winAmount = amount * 5;
  }
  // 2 out of 3 matching
  else if (r1 === r2 || r2 === r3 || r1 === r3) {
    winAmount = Math.floor(amount * 1.5);
  }

  if (winAmount > 0) {
    addCoins(userId, winAmount);
  }

  if (!stats[userId].slots) stats[userId].slots = { jackpots: 0, consecutiveJackpots: 0 };
  if (!stats[userId].slotsPlayed) stats[userId].slotsPlayed = 0;

  stats[userId].slotsPlayed++;
  recordDailyAction(userId, 'slots', 1);

  if (isJackpot) {
    stats[userId].slots.jackpots++;
    stats[userId].slots.consecutiveJackpots++;
  } else {
    stats[userId].slots.consecutiveJackpots = 0;
  }

  checkAchievements(userId);
  saveStats();

  return { ok: true, result: [r1, r2, r3], winAmount, isJackpot };
}

// Achievements
function checkAchievements(userId) {
  if (!stats[userId]) return;
  ensureInventoryExists(userId);

  // Il faut accéder dynamiquement à l'objet interne
  let newAchievements = [];

  // Jackpot 1
  if (stats[userId].slots && stats[userId].slots.jackpots >= 1 && !stats[userId].inventory['B_JACKPOT']) {
    addItemToInventory(userId, 'B_JACKPOT');
    addCoins(userId, 100);
    newAchievements.push('B_JACKPOT + 100 💰');
  }

  // 2 consecutive Jackpots
  if (stats[userId].slots && stats[userId].slots.consecutiveJackpots >= 2 && !stats[userId].inventory['T_LUCKY']) {
    addItemToInventory(userId, 'T_LUCKY');
    addCoins(userId, 500);
    newAchievements.push('T_LUCKY + 500 💰');
  }

  // All Fishes
  const allFishes = ['F_TRASH', 'F_COD', 'F_SALMON', 'F_TUNA', 'F_SHARK', 'F_KRAKEN'];
  let hasAllFishes = true;
  for (let f of allFishes) {
      if (!stats[userId].inventory[f] || stats[userId].inventory[f] <= 0) hasAllFishes = false;
  }

  if (hasAllFishes && !stats[userId].inventory['T_MASTER_FISHER']) {
    addItemToInventory(userId, 'T_MASTER_FISHER');
    addCoins(userId, 2000);
    newAchievements.push('T_MASTER_FISHER + 2000 💰');
  }

  return newAchievements;
}

// Coinflip
const activeCoinflips = new Map();

function createCoinflip(userId, targetId, amount) {
  if (!stats[userId] || !stats[targetId]) return { error: 'Utilisateur inconnu.' };
  if (amount <= 0) return { error: 'Mise invalide.' };

  if (stats[userId].bordelCoins < amount) return { error: "Tu n'as pas assez de pièces." };
  if (stats[targetId].bordelCoins < amount) return { error: "Ton adversaire n'a pas assez de pièces." };

  const flipId = `CF_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  activeCoinflips.set(flipId, {
    creator: userId,
    target: targetId,
    amount: amount,
    createdAt: Date.now()
  });

  // Timeout automatique au bout de 60 secondes
  setTimeout(() => {
    if (activeCoinflips.has(flipId)) {
      activeCoinflips.delete(flipId);
    }
  }, 60 * 1000);

  return { ok: true, flipId };
}

function acceptCoinflip(flipId, targetId) {
  const flip = activeCoinflips.get(flipId);
  if (!flip) return { error: 'Pari introuvable ou expiré.' };
  if (flip.target !== targetId) return { error: "Ce pari ne t'est pas destiné." };

  if (!spendCoins(flip.creator, flip.amount)) return { error: "Le créateur n'a plus les pièces requises." };
  if (!spendCoins(targetId, flip.amount)) {
    // Rend les pieces au createur si on les avait pris
    addCoins(flip.creator, flip.amount);
    return { error: "Tu n'as plus assez de pièces." };
  }

  activeCoinflips.delete(flipId);

  const totalPot = flip.amount * 2;
  const winner = Math.random() > 0.5 ? flip.creator : flip.target;
  const loser = winner === flip.creator ? flip.target : flip.creator;

  // 5% tax
  const tax = Math.floor(totalPot * 0.05);
  const payout = totalPot - tax;

  addCoins(winner, payout);
  saveStats();

  return { ok: true, winner, loser, amount: flip.amount, payout, tax };
}

function cancelCoinflip(flipId) {
   activeCoinflips.delete(flipId);
}

module.exports.claimDaily = claimDaily;
module.exports.getCollectionProgress = getCollectionProgress;
module.exports.fish = fish;
module.exports.sellFish = sellFish;
module.exports.playSlots = playSlots;
module.exports.checkAchievements = checkAchievements;
module.exports.createCoinflip = createCoinflip;
module.exports.acceptCoinflip = acceptCoinflip;
module.exports.cancelCoinflip = cancelCoinflip;

// --- ROULETTE ---
const activeRoulettes = new Map();

function createRoulette(userId, amount) {
  if (!stats[userId]) return { error: 'Utilisateur inconnu.' };
  if (amount <= 0) return { error: 'Mise invalide.' };
  if (stats[userId].bordelCoins < amount) return { error: "Tu n'as pas assez de pièces." };

  const rouletteId = `RO_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
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
      return { error: 'Certains joueurs n\'avaient plus les fonds. Annulation.' };
  }

  roulette.state = 'playing';
  roulette.alivePlayers = [...roulette.players];
  return { ok: true, players: roulette.players };
}

function shootRoulette(rouletteId) {
  const roulette = activeRoulettes.get(rouletteId);
  if (!roulette) return { error: 'Partie introuvable.' };
  if (roulette.state !== 'playing') return { error: 'La partie n\'est pas en cours.' };

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
  if (roulette.state !== 'proposing_draw') return { error: 'Pas de proposition d\'égalité en cours.' };
  if (!roulette.alivePlayers.includes(userId)) return { error: 'Tu n\'es pas en vie dans cette partie.' };

  if (vote === false) {
     // Someone declined draw, resume playing
     roulette.state = 'playing';
     return { ok: true, drawAccepted: false, message: 'Un joueur a refusé l\'égalité ! La partie reprend.' };
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

// --- ARENA ---
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

  const arenaId = `AR_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
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

// --- CRAFTING ---
const CRAFTING_RECIPES = {
  'R_IRON': {
    name: 'Canne en fer',
    cost: 1000,
    ingredients: { 'R_WOOD': 1 }
  },
  'R_GOLD': {
    name: 'Canne en or',
    cost: 5000,
    ingredients: { 'R_IRON': 1 }
  },
  'R_DIAMOND': {
    name: 'Canne en diamant',
    cost: 15000,
    ingredients: { 'R_GOLD': 1 }
  }
};

function craftItem(userId, targetItemId) {
  if (!stats[userId]) return { error: 'Utilisateur inconnu.' };
  ensureInventoryExists(userId);

  const recipe = CRAFTING_RECIPES[targetItemId];
  if (!recipe) return { error: 'Recette inconnue.' };

  const inv = stats[userId].inventory;

  // Verify ingredients
  for (const [ingId, qty] of Object.entries(recipe.ingredients)) {
     if (!inv[ingId] || inv[ingId] < qty) {
        return { error: `Il te manque des matériaux. Requis: ${qty}x ${ingId}` };
     }
  }

  // Verify and spend coins
  if (recipe.cost > 0) {
     if (!spendCoins(userId, recipe.cost)) {
        return { error: `Fonds insuffisants. Requis: ${recipe.cost} BordelCoins.` };
     }
  }

  // Consume ingredients
  for (const [ingId, qty] of Object.entries(recipe.ingredients)) {
     for (let i = 0; i < qty; i++) {
        removeItemFromInventory(userId, ingId);
     }
  }

  // Give crafted item
  addItemToInventory(userId, targetItemId);

  return { ok: true, item: targetItemId, itemName: recipe.name };
}

module.exports.craftItem = craftItem;
module.exports.CRAFTING_RECIPES = CRAFTING_RECIPES;
