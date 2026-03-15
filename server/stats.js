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

/**
 * Sauvegarder les stats sur le disque
 */
function saveStats() {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (err) {
    console.error('[Stats] Erreur lors de la sauvegarde:', err);
  }
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
 * Obtenir les stats d'un utilisateur
 */
function getUserStats(userId) {
  return stats[userId] || null;
}

/**
 * Obtenir le top N des utilisateurs
 */
function getLeaderboard(limit = 10) {
  return Object.entries(stats)
    .map(([userId, data]) => ({ userId, ...data }))
    .sort((a, b) => b.totalCount - a.totalCount)
    .slice(0, limit);
}

module.exports = {
  recordAction,
  getUserStats,
  getLeaderboard
};
