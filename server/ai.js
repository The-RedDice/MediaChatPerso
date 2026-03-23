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
          ]
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        const errorMsg = data.error ? (data.error.message || JSON.stringify(data.error)) : `HTTP ${res.status}`;
        throw new Error(`Erreur Groq API: ${errorMsg}`);
      }

      let text = data.choices[0].message.content;
      // Supprimer les blocs de réflexion générés par les modèles type "DeepSeek R1" ou "Thinking"
      // Si la réponse est tronquée et qu'il n'y a pas de </think> final, on supprime tout depuis <think>
      text = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim();
      // Supprimer le markdown
      text = text.replace(/[*_~`]/g, '').trim();

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
          model: 'qwen/qwen3-next-80b-a3b-instruct:free', // Modèle gratuit extrêmement stable et rapide sur OpenRouter
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

      let text = data.choices[0].message.content;
      // Supprimer les blocs de réflexion générés par les modèles type "DeepSeek R1" ou "Thinking"
      // Si la réponse est tronquée et qu'il n'y a pas de </think> final, on supprime tout depuis <think>
      text = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim();
      // Supprimer le markdown
      text = text.replace(/[*_~`]/g, '').trim();

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

// ─── GOOGLE GEMINI (Optimisé pour ne pas spammer l'API) ───
  const modelName = 'gemini-3.0-flash';
  const fullPromptGemini = `${systemPrompt}\n\nLe prompt de l'utilisateur qui te commande est le suivant : "${prompt}"`;

  // Vérification du cooldown
  if (global.geminiCooldownTimeout && Date.now() < global.geminiCooldownTimeout) {
    const timeLeft = Math.ceil((global.geminiCooldownTimeout - Date.now()) / 1000);
    return `Mon forfait Google est épuisé. Reviens dans ${timeLeft} secondes.`;
  }

  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    
    // Désactivation des filtres de sécurité pour autoriser l'humour noir et le sarcasme
    const safetySettings = [
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_NONE',
      }
    ];

    const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPromptGemini }] }],
        safetySettings: safetySettings,
    });

    const response = await result.response;
    let text = response.text();

    text = text.replace(/[*_~`]/g, '').trim();
    return text.length > 200 ? text.substring(0, 197) + '...' : text;

  } catch (apiError) {
    console.error('[Gemini AI] Erreur API :', apiError.message);
    
    // Gestion du vrai Rate Limit (429) : On met le bot en pause 60s
    if (apiError.status === 429 || (apiError.message && apiError.message.includes('429'))) {
      global.geminiCooldownTimeout = Date.now() + 60000;
      return "Google m'a mis en pause. T'as vraiment cru que j'allais bosser gratuitement h24 ?";
    }
    
    // Gestion des blocages de sécurité résiduels de Google
    if (apiError.message && (apiError.message.includes('SAFETY') || apiError.message.includes('blocked'))) {
       return "Ouh là, tu m'as demandé d'être trop méchant, même les serveurs de Google ont paniqué.";
    }

    return "J'ai eu un bug interne tellement grave que même moi je n'ai pas compris ce que je viens de dire.";
  }
} // <-- FIN DE LA FONCTION generateResponse

module.exports = { initAI, generateResponse };
