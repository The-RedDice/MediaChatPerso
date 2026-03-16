/**
 * Gestionnaire de stockage des mèmes personnels pour BordelBox
 */
const fs = require('fs');
const path = require('path');

const MEMES_FILE = path.join(__dirname, 'memes.json');

// Charger ou initialiser les mèmes
let memesData = {};

try {
  if (fs.existsSync(MEMES_FILE)) {
    const data = fs.readFileSync(MEMES_FILE, 'utf8');
    memesData = JSON.parse(data);
  }
} catch (err) {
  console.error('[Memes] Erreur lors du chargement des mèmes:', err);
}

let saveTimeout = null;

/**
 * Sauvegarder les mèmes sur le disque (version asynchrone débouncée)
 */
function saveMemes() {
  if (saveTimeout) return;

  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    try {
      const data = JSON.stringify(memesData, null, 2);
      fs.writeFile(MEMES_FILE, data, (err) => {
        if (err) {
          console.error('[Memes] Erreur lors de la sauvegarde:', err);
        }
      });
    } catch (err) {
      console.error('[Memes] Erreur lors de la sérialisation des mèmes:', err);
    }
  }, 1000);
}

/**
 * Ajouter un mème pour un utilisateur
 * @param {string} userId - L'ID Discord de l'utilisateur
 * @param {string} memeName - Le nom du mème (clé unique par utilisateur)
 * @param {object} memeData - Les données du mème { url, type, caption, tags }
 * @returns {object} - { success, message }
 */
function addMeme(userId, memeName, memeData) {
  if (!userId || !memeName) return { success: false, message: 'Paramètres invalides' };

  if (!memesData[userId]) {
    memesData[userId] = {};
  }

  // Vérifier si le nom existe déjà (insensible à la casse)
  const lowerName = memeName.toLowerCase();
  const existingKeys = Object.keys(memesData[userId]);
  const exists = existingKeys.some(k => k.toLowerCase() === lowerName);

  if (exists) {
    return { success: false, message: `Un mème nommé "${memeName}" existe déjà.` };
  }

  // Stocker avec le nom original comme clé, mais on pourrait aussi forcer minuscule
  memesData[userId][memeName] = {
    ...memeData,
    addedAt: Date.now()
  };

  saveMemes();
  return { success: true, message: 'Mème ajouté avec succès' };
}

/**
 * Obtenir les mèmes d'un utilisateur
 * @param {string} userId - L'ID Discord de l'utilisateur
 * @returns {object} - Dictionnaire des mèmes de l'utilisateur
 */
function getUserMemes(userId) {
  return memesData[userId] || {};
}

/**
 * Supprimer un mème d'un utilisateur
 * @param {string} userId - L'ID Discord de l'utilisateur
 * @param {string} memeName - Le nom du mème à supprimer
 * @returns {object} - { success, message, deletedMeme }
 */
function removeMeme(userId, memeName) {
  if (!userId || !memeName || !memesData[userId]) {
    return { success: false, message: 'Mème introuvable' };
  }

  // Recherche insensible à la casse
  const lowerName = memeName.toLowerCase();
  const actualKey = Object.keys(memesData[userId]).find(k => k.toLowerCase() === lowerName);

  if (!actualKey) {
    return { success: false, message: 'Mème introuvable' };
  }

  const deletedMeme = memesData[userId][actualKey];
  delete memesData[userId][actualKey];

  // Nettoyer si l'utilisateur n'a plus de mèmes
  if (Object.keys(memesData[userId]).length === 0) {
    delete memesData[userId];
  }

  saveMemes();
  return { success: true, message: 'Mème supprimé', deletedMeme };
}

module.exports = {
  addMeme,
  getUserMemes,
  removeMeme
};
