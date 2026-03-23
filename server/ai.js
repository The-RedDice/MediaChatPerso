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

  try {
    // Some API keys/regions might not have access to 'gemini-1.5-flash' yet,
    // or the name could be slightly different depending on the account tier.
    // 'gemini-pro' (1.0) is widely available as a reliable fallback.
    let model;
    try {
        model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    } catch (e) {
        model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    }

    const systemPrompt = `Tu es une IA sarcastique, fun et très brève qui s'affiche en gros caractères sur l'écran d'un utilisateur. Ton message doit être très court (maximum 150 caractères) car il sera lu très vite. Ne mets pas de formatage Markdown (pas d'astérisques ou gras), juste du texte brut. Le prompt de l'utilisateur qui te commande est le suivant : "${prompt}"`;

    let result;
    try {
        result = await model.generateContent(systemPrompt);
    } catch (apiError) {
        // If 1.5-flash fails (e.g. 404 Not Found), fallback to gemini-pro
        if (apiError.status === 404 || (apiError.message && apiError.message.includes('404'))) {
            console.warn('[Gemini AI] gemini-1.5-flash not found, falling back to gemini-pro...');
            model = genAI.getGenerativeModel({ model: 'gemini-pro' });
            result = await model.generateContent(systemPrompt);
        } else {
            throw apiError;
        }
    }

    const response = await result.response;
    let text = response.text();

    text = text.replace(/[*_~`]/g, '').trim();

    if (text.length > 200) {
      text = text.substring(0, 197) + '...';
    }

    return text;
  } catch (err) {
    console.error('[Gemini AI] Erreur de génération :', err);
    throw new Error('Erreur lors de la génération IA: ' + (err.message || err));
  }
}

module.exports = { initAI, generateResponse };
