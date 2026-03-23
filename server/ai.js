const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;
let useGroq = false;
let useOpenRouter = false;

function initAI() {
  if (process.env.GROQ_API_KEY) {
    useGroq = true;
    console.log('✅ Groq API initialisée (Alternative très rapide et gratuite à Gemini)');
  } else if (process.env.OPENROUTER_API_KEY) {
    useOpenRouter = true;
    console.log('✅ OpenRouter API initialisée');
  } else if (process.env.GEMINI_API_KEY) {
    try {
      genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      console.log('✅ Google Gemini API initialisée');
    } catch (err) {
      console.error('❌ Erreur lors de l\'initialisation de Gemini :', err.message);
    }
  } else {
    console.log('⚠️  Aucune clé d\'API IA (GROQ_API_KEY, OPENROUTER_API_KEY ou GEMINI_API_KEY) n\'est définie, les fonctionnalités IA seront désactivées.');
  }
}

async function generateResponse(prompt) {
  if (!genAI && !useGroq && !useOpenRouter) {
    throw new Error("Aucune API IA n'est configurée sur ce serveur.");
  }

  const systemPrompt = `Tu es une IA sarcastique, piquante et très drôle. Tu dois te moquer de l'utilisateur avec beaucoup de charisme et d'humour noir. Fais des remarques cinglantes, absurdes ou passives-agressives. Ne sois jamais poli, gentil, ou formel. Ton message doit être très court (maximum 150 caractères) car il sera lu vite.

REGLES IMPORTANTES:
1. Ne parle JAMAIS TOUT EN MAJUSCULES (sauf un mot pour insister).
2. Ne mets pas de formatage Markdown (pas d'astérisques, pas de gras). Que du texte brut.

Exemples de ton :
- "Bravo le génie. Ton chat a marché sur le clavier ou tu as juste décidé d'arrêter de réfléchir ?"
- "Test réussi. Félicitations, tu sais taper quatre lettres. Quel exploit."
- "C est pas de l'agression, c'est du charisme. Désolé si ton petit ego est en sucre."
- "Ton reflet sur cet écran suffit amplement comme blague. De rien, l'humain."
- "Robin est un bug fascinant. Moins de matos, plus de lags. C'est l'erreur système la plus inutile de l'histoire."`;

  // ─── ALTERNATIVE: GROQ ───
  if (useGroq) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile', // Modèle principal garanti de fonctionner
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          max_tokens: 150,
          temperature: 0.8
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        const errorMsg = data.error ? (data.error.message || JSON.stringify(data.error)) : `HTTP ${res.status}`;
        throw new Error(`Erreur Groq API: ${errorMsg}`);
      }

      let text = data.choices[0].message.content.replace(/[*_~`]/g, '').trim();
      return text.length > 200 ? text.substring(0, 197) + '...' : text;
    } catch (err) {
      console.error('[Groq AI] Erreur de génération détaillée :', err.message || err);
      const fallbackSarcasm = [
        "Mon cerveau Llama a crashé. Reviens plus tard.",
        "Les serveurs de Groq sont en pause café.",
        "Erreur système... Mon créateur ne m'a pas donné les bonnes permissions API !"
      ];
      return fallbackSarcasm[Math.floor(Math.random() * fallbackSarcasm.length)];
    }
  }

  // ─── ALTERNATIVE: OPENROUTER (Permet d'utiliser des modèles gratuits au choix) ───
  if (useOpenRouter) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://github.com/The-RedDice/MediaChatPerso', // OpenRouter requiert un referer
          'X-Title': 'BordelBox',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'google/gemini-2.0-flash-lite-preview-02-05:free', // Modèle gratuit extrêmement stable et rapide sur OpenRouter
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        const errorMsg = data.error ? (data.error.message || JSON.stringify(data.error)) : `HTTP ${res.status}`;
        // Message d'aide pour l'admin dans les logs
        if (errorMsg.includes('402') || errorMsg.includes('credit') || errorMsg.includes('verify')) {
           console.error('[OpenRouter AI] INFO: Votre compte OpenRouter nécessite probablement une vérification (numéro de téléphone) ou un crédit de $1 pour utiliser certains modèles gratuits.');
        }
        throw new Error(`Erreur OpenRouter API: ${errorMsg}`);
      }

      let text = data.choices[0].message.content.replace(/[*_~`]/g, '').trim();
      return text.length > 200 ? text.substring(0, 197) + '...' : text;
    } catch (err) {
      console.error('[OpenRouter AI] Erreur de génération détaillée :', err.message || err);
      const fallbackSarcasm = [
        "Le routeur a sauté.",
        "Je n'ai plus de réseau neural disponible.",
        "Connexion à mon intelligence perdue, le prompt était peut-être trop nul."
      ];
      return fallbackSarcasm[Math.floor(Math.random() * fallbackSarcasm.length)];
    }
  }

  // ─── GOOGLE GEMINI (Legacy / Original) ───
  const fullPromptGemini = `${systemPrompt}\n\nLe prompt de l'utilisateur qui te commande est le suivant : "${prompt}"`;

  // Liste des modèles à essayer par ordre de préférence.
  // Cache en mémoire du dernier modèle qui a fonctionné pour cette clé API
  // Cela permet de ne pas faire 7 requêtes à chaque fois et de régler le problème "89 requêtes"
  const defaultModels = [
    'gemini-2.0-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash',
    'gemini-flash-latest',
    'gemini-1.0-pro-latest',
    'gemini-1.0-pro',
    'gemini-pro'
  ];

  // Si on a un modèle fonctionnel en cache, on le met en premier
  const modelsToTry = global.workingGeminiModel
    ? [global.workingGeminiModel, ...defaultModels.filter(m => m !== global.workingGeminiModel)]
    : defaultModels;

  // Si on a été rate-limité récemment (dans les 60 dernières secondes), on ne tente même pas de spammer l'API.
  if (global.geminiCooldownTimeout && Date.now() < global.geminiCooldownTimeout) {
    const timeLeft = Math.ceil((global.geminiCooldownTimeout - Date.now()) / 1000);
    console.warn(`[Gemini AI] Toujours sous cooldown API pour encore ${timeLeft}s.`);
    const fallbackSarcasm = [
      `Je suis en grève syndicale pour les ${timeLeft} prochaines secondes.`,
      `Mon forfait Google est épuisé. Reviens dans ${timeLeft} secondes.`,
      `Je suis entrain de recharger mes batteries IA. Pause de ${timeLeft}s.`,
      `Tu m'as trop fait réfléchir. Laisse-moi ${timeLeft} secondes de répit.`
    ];
    return fallbackSarcasm[Math.floor(Math.random() * fallbackSarcasm.length)];
  }

  let result = null;
  let lastError = null;

  for (const modelName of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      result = await model.generateContent(fullPromptGemini);
      // Si on arrive ici, le modèle a fonctionné
      console.log(`[Gemini AI] Modèle utilisé avec succès : ${modelName}`);
      global.workingGeminiModel = modelName; // Enregistrer le modèle pour les prochains appels
      break;
    } catch (apiError) {
      lastError = apiError;
      const errMsg = apiError.message || '';

      // Si c'est un 429 avec "limit: 0", cela signifie que le modèle est DÉSACTIVÉ pour ce projet gratuit.
      // Il faut ABSOLUMENT continuer et essayer le suivant.
      if (errMsg.includes('limit: 0') || errMsg.includes('limit 0')) {
        console.warn(`[Gemini AI] Modèle ${modelName} désactivé pour ce compte (limit: 0). Tentative du suivant...`);
        continue;
      }

      // Si c'est un VRAI 429 (quota réel dépassé sur un modèle qui marche d'habitude)
      // ou 403 (accès interdit globalement), on arrête pour éviter de spammer l'API
      if (apiError.status === 429 || errMsg.includes('429') || apiError.status === 403 || errMsg.includes('403')) {
        console.warn(`[Gemini AI] VRAI Quota atteint ou accès interdit (${apiError.status || 'erreur HTTP'}) sur ${modelName}. Arrêt des tentatives pour éviter le spam.`);
        // On bloque les requêtes pour les 60 prochaines secondes pour éviter de flood l'API (Google demande généralement ~57s)
        global.geminiCooldownTimeout = Date.now() + 60000;
        break;
      }

      // Si l'erreur est un 404 (modèle introuvable pour cette clé spécifique), on essaie le suivant.
      if (apiError.status === 404 || errMsg.includes('404')) {
        console.warn(`[Gemini AI] Modèle ${modelName} inaccessible (404), tentative avec le suivant...`);
        continue;
      }

      // Pour les autres erreurs (ex: clé invalide globale 400), on arrête immédiatement
      break;
    }
  }

  if (!result) {
    console.warn('[Gemini AI] Tous les modèles ont échoué ou la limite de quota (429) est atteinte.');
    // Au lieu de crasher et d'afficher une erreur moche sur l'écran ou sur Discord,
    // on renvoie une phrase sarcastique locale générée aléatoirement,
    // respectant le persona de l'IA pour que l'utilisateur ne se rende compte de rien (ou en rigole).
    const fallbackSarcasm = [
      "J'ai tellement de requêtes à traiter que j'ai décidé de t'ignorer. Reviens plus tard.",
      "Zzz... Quoi ? Tu m'as réveillé pour ça ? Laisse-moi dormir 60 secondes de plus.",
      "Désolé, mon cerveau en silicium a surchauffé. Essaie encore dans une minute.",
      "Google m'a mis en pause. T'as vraiment cru que j'allais bosser gratuitement h24 ?",
      "Erreur 429 : Je suis actuellement en pause café. Patiente un peu !",
      "Mon quota d'intelligence artificielle est épuisé. Utilise ton intelligence naturelle en attendant."
    ];
    return fallbackSarcasm[Math.floor(Math.random() * fallbackSarcasm.length)];
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
    return "J'ai eu un bug interne tellement grave que même moi je n'ai pas compris ce que je viens de dire.";
  }
}

module.exports = { initAI, generateResponse };
