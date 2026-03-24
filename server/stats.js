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
function recordAction(userId, username, type) {
  if (!userId) return; // Si pas d'ID, on ne peut pas track de façon fiable

  if (!stats[userId]) {
    stats[userId] = {
      username: username,
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
    // Mettre à jour le pseudo s'il a changé
    stats[userId].username = username;
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
  } else if (type === 'file') {
    stats[userId].fileCount++;
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

  if (typeof stats[userId].skippedCount !== 'number') {
    stats[userId].skippedCount = 0;
  }

  stats[userId].skippedCount++;
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
      username: targetUsername,
      mediaCount: 0, fileCount: 0, messageCount: 0, totalCount: 0,
      lastAction: Date.now(),
      bordelCoins: 0,
      votesGiven: {}
    };
  } else {
    stats[targetId].username = targetUsername;
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
  stats[targetId].bordelCoins += value;

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

  stats[userId].bordelCoins += amount;

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
function getLeaderboard(type = 'media', limit = 10) {
  return Object.entries(stats)
    .map(([userId, data]) => ({ userId, ...data }))
    .sort((a, b) => {
      if (type === 'flop') {
        const aFlop = a.skippedCount || 0;
        const bFlop = b.skippedCount || 0;
        return bFlop - aFlop;
      } else if (type === 'coins') {
        const aCoins = a.bordelCoins !== undefined ? a.bordelCoins : (a.reputation || 0);
        const bCoins = b.bordelCoins !== undefined ? b.bordelCoins : (b.reputation || 0);
        return bCoins - aCoins;
      } else {
        // type === 'media'
        const aMedia = (a.mediaCount || 0) + (a.fileCount || 0);
        const bMedia = (b.mediaCount || 0) + (b.fileCount || 0);
        return bMedia - aMedia;
      }
    })
    .slice(0, limit);
}

/**
 * Enregistrer le profil (style) d'un utilisateur
 */
function saveUserProfile(userId, username, profileData) {
  if (!userId) return;
  if (!stats[userId]) {
    stats[userId] = {
      username: username,
      mediaCount: 0,
      fileCount: 0,
      messageCount: 0,
      totalCount: 0,
      lastAction: Date.now(),
      bordelCoins: 0,
      votesGiven: {}
    };
  } else {
    stats[userId].username = username;
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
  getUnlockedStyles
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

function generateProceduralItem() {
  const prefix = PROCEDURAL_PREFIXES[Math.floor(Math.random() * PROCEDURAL_PREFIXES.length)];
  const noun = PROCEDURAL_NOUNS[Math.floor(Math.random() * PROCEDURAL_NOUNS.length)];
  const suffix = PROCEDURAL_SUFFIXES[Math.floor(Math.random() * PROCEDURAL_SUFFIXES.length)];
  const name = `${prefix} ${noun} ${suffix}`;

  // Randomize category (titles or badges are best for procedural items)
  const category = Math.random() > 0.5 ? 'titles' : 'badges';
  const id = `PROC_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  let item = {
    id: id,
    name: name,
    rarity: "transcendant",
    category: category
  };

  if (category === 'badges') {
    const emojis = ["🔥", "✨", "🌟", "👁️", "🌌", "⚡", "🔮", "💎", "🐉", "🔱"];
    item.emoji = emojis[Math.floor(Math.random() * emojis.length)];
  }

  return item;
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
    wonItem = generateProceduralItem();

    // Save it to a custom DB inside the user's inventory or global custom items so it can be equipped
    if (!stats[userId].proceduralItems) {
      stats[userId].proceduralItems = {};
    }
    stats[userId].proceduralItems[wonItem.id] = wonItem;
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
  if (!category && stats[userId] && stats[userId].proceduralItems && stats[userId].proceduralItems[itemId]) {
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
  if (!userId || !stats[userId] || !stats[userId].proceduralItems) {
    return itemsDb;
  }

  // Create a merged DB for this user so procedural items can be resolved for names/emojis
  const mergedDb = JSON.parse(JSON.stringify(itemsDb));
  for (const procId in stats[userId].proceduralItems) {
    const procItem = stats[userId].proceduralItems[procId];
    if (!mergedDb[procItem.category]) mergedDb[procItem.category] = {};
    mergedDb[procItem.category][procId] = procItem;
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
