const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;

function initAI() {
  if (process.env.GEMINI_API_KEY) {
    try {
      genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      console.log('✅ Google Gemini API initialisée');
    } catch (err) {
      console.error('❌ Erreur lors de l\'initialisation de Gemini :', err.message);
    }
  } else {
    console.log('⚠️  GEMINI_API_KEY non définie, les fonctionnalités IA seront désactivées.');
  }
}

async function generateResponse(prompt) {
  if (!genAI) {
    throw new Error("L'API Gemini n'est pas configurée sur ce serveur.");
  }

  const systemPrompt = `Tu es une IA sarcastique, fun et très brève qui s'affiche en gros caractères sur l'écran d'un utilisateur. Ton message doit être très court (maximum 150 caractères) car il sera lu très vite. Ne mets pas de formatage Markdown (pas d'astérisques ou gras), juste du texte brut. Le prompt de l'utilisateur qui te commande est le suivant : "${prompt}"`;

  // Liste des modèles à essayer par ordre de préférence.
  // Les modèles plus récents ou avec un nom alternatif sont essayés en premier,
  // car certains comptes peuvent ne pas avoir accès aux alias standards ou aux modèles deprecates.
  const modelsToTry = [
    'gemini-2.0-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash',
    'gemini-flash-latest',
    'gemini-1.0-pro-latest',
    'gemini-1.0-pro',
    'gemini-pro'
  ];

  let result = null;
  let lastError = null;

  for (const modelName of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      result = await model.generateContent(systemPrompt);
      // Si on arrive ici, le modèle a fonctionné
      console.log(`[Gemini AI] Modèle utilisé avec succès : ${modelName}`);
      break;
    } catch (apiError) {
      lastError = apiError;
      // Si l'erreur est un 404 (modèle introuvable ou non supporté), on essaie le modèle suivant
      if (apiError.status === 404 || (apiError.message && apiError.message.includes('404'))) {
        console.warn(`[Gemini AI] Modèle ${modelName} non trouvé (404), tentative avec le suivant...`);
        continue;
      }
      // Pour toute autre erreur (ex: clé invalide, quota dépassé), on arrête immédiatement
      break;
    }
  }

  if (!result) {
    console.error('[Gemini AI] Erreur de génération (tous les modèles ont échoué) :', lastError);
    throw new Error('Erreur lors de la génération IA: ' + (lastError?.message || lastError));
  }

  try {
    const response = await result.response;
    let text = response.text();

    text = text.replace(/[*_~`]/g, '').trim();

    if (text.length > 200) {
      text = text.substring(0, 197) + '...';
    }

    return text;
  } catch (err) {
    console.error('[Gemini AI] Erreur lors de l\'extraction du texte :', err);
    throw new Error('Erreur lors de la génération IA: ' + (err.message || err));
  }
}

module.exports = { initAI, generateResponse };
