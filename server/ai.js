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
  // Restreint à 3 modèles courants pour éviter de saturer l'API en cas de limite de quota,
  // tout en utilisant des alias qui fonctionnent sur la plupart des clés API,
  // et en incluant 'gemini-pro' comme filet de sécurité pour les anciens comptes.
  const modelsToTry = [
    'gemini-2.0-flash',
    'gemini-1.5-pro-latest',
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
      const errMsg = apiError.message || '';

      // Si l'erreur est un 404 (modèle introuvable), un 403 (accès interdit/région),
      // ou un 429 (quota dépassé pour ce modèle spécifique dans le free tier, souvent limit: 0)
      if (
        apiError.status === 404 || errMsg.includes('404') ||
        apiError.status === 403 || errMsg.includes('403') ||
        apiError.status === 429 || errMsg.includes('429')
      ) {
        console.warn(`[Gemini AI] Modèle ${modelName} inaccessible ou quota atteint (${apiError.status || 'erreur HTTP'}), tentative avec le suivant...`);
        continue;
      }

      // Pour les autres erreurs (ex: clé invalide globale 400), on arrête immédiatement
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
