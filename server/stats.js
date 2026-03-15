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
      reputation: 0,
      votesGiven: {}
    };
  } else {
    // Mettre à jour le pseudo s'il a changé
    stats[userId].username = username;
    // Retrocompatibilité : si firstAction n'existe pas, on l'initialise
    if (!stats[userId].firstAction) {
      stats[userId].firstAction = stats[userId].lastAction || Date.now();
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
      reputation: 0,
      votesGiven: {}
    };
  } else if (!stats[voterId].votesGiven) {
    stats[voterId].votesGiven = {};
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
      reputation: 0,
      votesGiven: {}
    };
  } else {
    stats[targetId].username = targetUsername;
    if (typeof stats[targetId].reputation !== 'number') {
      stats[targetId].reputation = 0;
    }
  }

  // Appliquer le vote
  stats[voterId].votesGiven[messageId] = value;
  stats[targetId].reputation += value;

  saveStats();

  return { success: true, newScore: stats[targetId].reputation };
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
      } else if (type === 'rep') {
        const aRep = a.reputation || 0;
        const bRep = b.reputation || 0;
        return bRep - aRep;
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
      reputation: 0,
      votesGiven: {}
    };
  } else {
    stats[userId].username = username;
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
  updateReputation
};
