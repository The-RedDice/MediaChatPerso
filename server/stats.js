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
      lastAction: Date.now()
    };
  } else {
    // Mettre à jour le pseudo s'il a changé
    stats[userId].username = username;
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
 * Obtenir le top N des utilisateurs
 * @param {string} type - 'media' ou 'flop'
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
      lastAction: Date.now()
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
  getUserProfile
};
