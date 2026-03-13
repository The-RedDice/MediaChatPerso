const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const MODELS_DIR = path.resolve(__dirname, 'tts_models');

/**
 * Lit les dossiers de modèles TTS disponibles dans ./tts_models/
 */
function getAvailableModels() {
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    return [];
  }
  return fs.readdirSync(MODELS_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
}

/**
 * Génère un fichier audio TTS en utilisant le modèle spécifié.
 * Attend que le modèle soit un exécutable (ou un script bash/bat)
 * dans tts_models/[nom_du_modele]/run.sh (ou .bat sur Windows)
 * qui prend en arguments : <texte> <chemin_sortie>
 */
function generateTTS(text, modelName, outputFilePath) {
  return new Promise((resolve, reject) => {
    if (!text || !modelName) return resolve(null);

    const available = getAvailableModels();
    if (!available.includes(modelName)) {
      console.warn(`[TTS] Modèle invalide ou non autorisé : ${modelName}`);
      return resolve(null);
    }

    const isWindows = process.platform === 'win32';
    const scriptName = isWindows ? 'run.bat' : 'run.sh';
    const modelScriptPath = path.join(MODELS_DIR, modelName, scriptName);

    if (!fs.existsSync(modelScriptPath)) {
      console.warn(`[TTS] Modèle introuvable ou script manquant : ${modelScriptPath}`);
      return resolve(null);
    }

    execFile(modelScriptPath, [text, outputFilePath], (err) => {
      if (err) {
        console.error(`[TTS] Erreur de génération avec ${modelName}:`, err.message);
        return resolve(null);
      }
      resolve(outputFilePath);
    });
  });
}

module.exports = {
  getAvailableModels,
  generateTTS
};
