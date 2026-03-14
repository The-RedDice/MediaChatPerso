/**
 * BordelBox Discord Bot
 * Discord.js v14 — Slash Commands + Rich Presence dynamique
 */

'use strict';

require('dotenv').config({ path: '../.env' });

const { Client, GatewayIntentBits, Events, ActivityType } = require('discord.js');
// fetch est natif depuis Node.js 18 — pas besoin de node-fetch

// ─── Config ──────────────────────────────────────────────

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const TOKEN      = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error('❌  DISCORD_TOKEN manquant dans .env');
  process.exit(1);
}

// ─── Client Discord ──────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ─── Helpers API ─────────────────────────────────────────

async function apiPost(endpoint, body) {
  const res = await fetch(`${SERVER_URL}/api${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiGet(endpoint) {
  const res = await fetch(`${SERVER_URL}/api${endpoint}`);
  return res.json();
}

// ─── Rich Presence dynamique ─────────────────────────────

async function updatePresence() {
  try {
    const { clients } = await apiGet('/clients');
    const count = Array.isArray(clients) ? clients.length : 0;

    client.user.setPresence({
      activities: [{
        name: count === 0
          ? 'Aucune victime connectée 😴'
          : `${count} PC${count > 1 ? 's' : ''} sous surveillance 👁️`,
        type: ActivityType.Watching,
      }],
      status: count === 0 ? 'idle' : 'online',
    });
  } catch {
    client.user.setPresence({
      activities: [{ name: 'Serveur inaccessible ⚠️', type: ActivityType.Watching }],
      status: 'dnd',
    });
  }
}

// ─── Ready ───────────────────────────────────────────────

client.once(Events.ClientReady, async (c) => {
  console.log(`\n✅  Bot connecté : ${c.user.tag}`);
  await updatePresence();
  // Rafraîchit la présence toutes les 30 secondes
  setInterval(updatePresence, 30_000);
});

// ─── Gestion des interactions ────────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // Réponse différée pour les commandes longues
  if (commandName === 'sendurl' || commandName === 'sendfile' || commandName === 'message' || commandName === 'online') {
    await interaction.deferReply();
  } else if (commandName === 'tuto') {
    await interaction.deferReply({ ephemeral: true });
  } else {
    await interaction.deferReply({ ephemeral: true });
  }

  try {
    switch (commandName) {

      // ── /sendurl ───────────────────────────────────────
      case 'sendurl': {
        const url     = interaction.options.getString('lien', true);
        const targetUser = interaction.options.getUser('cible');
        const target  = targetUser ? targetUser.username : 'all';
        const caption = interaction.options.getString('text') || '';
        const ttsVoice = interaction.options.getString('tts') || '';
        const greenscreen = interaction.options.getBoolean('greenscreen') || false;

        const senderName = interaction.user.displayName || interaction.user.username;
        const avatarUrl  = interaction.user.displayAvatarURL({ size: 64, extension: 'png' });

        await interaction.editReply({
          content: `⏳ Traitement de \`${url}\` en cours…`,
        });

        const data = await apiPost('/sendurl', { url, target, caption, senderName, avatarUrl, ttsVoice, greenscreen });

        if (data.error) {
          await interaction.editReply(`❌ Erreur : ${data.error}`);
          return;
        }

        if (data.directUrl) {
          await interaction.editReply(
            `✅ Média envoyé à **${target === 'all' ? 'tout le monde' : target}** !\n` +
            (caption ? `\n💬 Caption : "${caption}"` : '')
          );
        } else {
          await interaction.editReply(
            `✅ Vidéo envoyée à **${target === 'all' ? 'tout le monde' : target}** !\n` +
            `📁 Fichier : \`${data.filename}\`` +
            (caption ? `\n💬 Caption : "${caption}"` : '')
          );
        }
        updatePresence();
        break;
      }

      // ── /sendfile ──────────────────────────────────────
      case 'sendfile': {
        const attachment = interaction.options.getAttachment('fichier', true);
        const targetUser = interaction.options.getUser('cible');
        const target  = targetUser ? targetUser.username : 'all';
        const caption    = interaction.options.getString('text') || '';
        const ttsVoice = interaction.options.getString('tts') || '';
        const greenscreen = interaction.options.getBoolean('greenscreen') || false;

        if (attachment.size > 250 * 1024 * 1024) {
          await interaction.editReply(`❌ Erreur : Le fichier dépasse la limite de 250 Mo.`);
          return;
        }

        const senderName = interaction.user.displayName || interaction.user.username;
        const avatarUrl  = interaction.user.displayAvatarURL({ size: 64, extension: 'png' });

        const fileUrl  = attachment.url;
        let fileType = 'image';
        if (attachment.contentType?.startsWith('audio')) {
          fileType = 'audio';
        } else if (attachment.contentType?.startsWith('video')) {
          fileType = 'video';
        }

        const data = await apiPost('/sendfile', { fileUrl, fileType, target, caption, senderName, avatarUrl, ttsVoice, greenscreen });

        if (data.error) {
          await interaction.editReply(`❌ Erreur : ${data.error}`);
          return;
        }

        await interaction.editReply(
          `✅ Fichier (${fileType}) envoyé à **${target === 'all' ? 'tout le monde' : target}** !` +
          (caption ? `\n💬 Caption : "${caption}"` : '')
        );
        break;
      }

      // ── /message ───────────────────────────────────────
      case 'message': {
        const text   = interaction.options.getString('texte', true);
        const targetUser = interaction.options.getUser('cible');
        const target  = targetUser ? targetUser.username : 'all';
        const ttsVoice = interaction.options.getString('tts') || '';
        const greenscreen = interaction.options.getBoolean('greenscreen') || false;

        const senderName = interaction.user.displayName || interaction.user.username;
        const avatarUrl  = interaction.user.displayAvatarURL({ size: 64, extension: 'png' });

        const data = await apiPost('/message', { text, target, senderName, avatarUrl, ttsVoice, greenscreen });

        if (data.error) {
          await interaction.editReply(`❌ Erreur : ${data.error}`);
          return;
        }

        await interaction.editReply(
          `💬 Message envoyé à **${target === 'all' ? 'tout le monde' : target}** :\n> ${text}`
        );
        break;
      }

      // ── /online ────────────────────────────────────────
      case 'online': {
        const data = await apiGet('/clients');

        if (!data.clients || data.clients.length === 0) {
          await interaction.editReply('😴 Aucun client connecté en ce moment.');
          return;
        }

        const list = data.clients.map(p => `• \`${p}\``).join('\n');
        await interaction.editReply(
          `👁️ **${data.clients.length} client(s) en ligne :**\n${list}`
        );
        break;
      }

      // ── /tuto ──────────────────────────────────────────
      case 'tuto': {
        const tutoMessage = `
**Bienvenue sur BordelBox ! 🗃️**

BordelBox est un système permettant d'afficher des médias et des messages en direct sur les écrans des ordinateurs connectés via l'overlay client.

**💻 Commandes disponibles :**
\` /sendurl \` : Envoie une vidéo YouTube, TikTok ou un lien direct (mp4, mp3, image) sur les PC.
\` /sendfile \` : Permet d'uploader directement un fichier (image, vidéo, audio) depuis Discord.
\` /message \` : Affiche un gros texte animé sur les écrans.
\` /online \` : Affiche la liste des PC actuellement connectés à BordelBox.
\` /tuto \` : Affiche ce message d'aide.

**✨ Options des commandes d'envoi (\`/sendurl\`, \`/sendfile\`, \`/message\`) :**
- **cible** : Permet de choisir un PC spécifique (par son pseudo). Si vide, l'envoi se fait sur tous les PC connectés.
- **text** / **texte** : Un texte d'accompagnement affiché sous le média.
- **tts** : Génère une voix (Text-to-Speech) qui lit votre texte en même temps. Il faut indiquer le nom du modèle (ex: "mario").
- **greenscreen** : Active un filtre d'incrustation (fond vert) pour rendre le fond du média transparent sur l'overlay.

**🎙️ Comment fonctionne le TTS (Text-to-Speech) ?**
Dans l'option \`tts\`, vous devez entrer le nom exact d'un modèle vocal (ex: "robot"). Si le modèle existe sur le serveur, il va générer l'audio et le jouer en même temps que votre média ou texte. De nouveaux modèles peuvent être ajoutés par l'administrateur directement sur le serveur Ubuntu !
        `.trim();

        await interaction.editReply({ content: tutoMessage });
        break;
      }

      default:
        await interaction.editReply('❓ Commande inconnue.');
    }
  } catch (err) {
    console.error(`[Bot Error] ${commandName}:`, err.message);
    const msg = `❌ Impossible de contacter le serveur BordelBox.\n\`${err.message}\``;
    if (interaction.deferred) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});

// ─── Connexion ───────────────────────────────────────────

client.login(TOKEN);
