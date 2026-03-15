/**
 * BordelBox Discord Bot
 * Discord.js v14 — Slash Commands + Rich Presence dynamique
 */

'use strict';

require('dotenv').config({ path: '../.env' });

const { Client, GatewayIntentBits, Events, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

async function apiDelete(endpoint) {
  const res = await fetch(`${SERVER_URL}/api${endpoint}`, {
    method: 'DELETE'
  });
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
  if (interaction.isButton()) {
    const customId = interaction.customId;

    // Gérer les boutons "Vider la file" et "Skip actuel"
    if (customId.startsWith('clear_')) {
      const target = customId.replace('clear_', '');
      try {
        await apiDelete(`/queue/${encodeURIComponent(target)}`);
        await interaction.reply({ content: `🗑️ La file d'attente de **${target}** a été entièrement vidée.`, ephemeral: false });
      } catch (err) {
        await interaction.reply({ content: `❌ Erreur lors du vidage de la file.`, ephemeral: true });
      }
    } else if (customId.startsWith('skip_')) {
      const target = customId.replace('skip_', '');
      try {
        const res = await apiPost('/voteskip', { voterId: interaction.user.id });
        if (res.skipped) {
          await interaction.reply({ content: `⏩ Vote validé, média en cours pour **${target}** passé !`, ephemeral: false });
        } else {
          await interaction.reply({ content: `🗳️ Vote pour skip enregistré (${res.currentVotes}/${res.requiredVotes}).`, ephemeral: false });
        }
      } catch (err) {
        await interaction.reply({ content: `❌ Erreur lors du skip.`, ephemeral: true });
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // Réponse différée pour les commandes longues
  if (commandName === 'sendurl' || commandName === 'sendfile' || commandName === 'message' || commandName === 'online' || commandName === 'stats' || commandName === 'leaderboard' || commandName === 'queue') {
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
        const userId     = interaction.user.id;

        await interaction.editReply({
          content: `⏳ Traitement de \`${url}\` en cours…`,
        });

        const data = await apiPost('/sendurl', { url, target, caption, senderName, avatarUrl, ttsVoice, greenscreen, userId });

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
        const userId     = interaction.user.id;

        const fileUrl  = attachment.url;
        let fileType = 'image';
        if (attachment.contentType?.startsWith('audio')) {
          fileType = 'audio';
        } else if (attachment.contentType?.startsWith('video')) {
          fileType = 'video';
        }

        if (attachment.size > 250 * 1024 * 1024) {
          await interaction.editReply(`❌ Erreur : Le fichier dépasse la limite de 250 Mo.`);
          return;
        }

        const data = await apiPost('/sendfile', { fileUrl, fileType, target, caption, senderName, avatarUrl, ttsVoice, greenscreen, userId });

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

      // ── /stats ─────────────────────────────────────────
      case 'stats': {
        const userOpt = interaction.options.getUser('utilisateur');
        const targetUserId = userOpt ? userOpt.id : interaction.user.id;
        const targetUserName = userOpt ? userOpt.username : interaction.user.username;

        const data = await apiGet(`/stats/${targetUserId}`);

        if (data.error || !data.totalCount) {
          await interaction.editReply(`📊 **${targetUserName}** n'a encore rien envoyé sur BordelBox.`);
          return;
        }

        const msg = `📊 **Statistiques de ${data.username}** :\n` +
          `• Total envoyé : **${data.totalCount}**\n` +
          `• Vidéos (yt-dlp) : ${data.mediaCount || 0}\n` +
          `• Fichiers directs : ${data.fileCount || 0}\n` +
          `• Messages texte : ${data.messageCount || 0}\n` +
          `• Dernière activité : <t:${Math.floor(data.lastAction / 1000)}:R>`;

        await interaction.editReply(msg);
        break;
      }

      // ── /leaderboard ───────────────────────────────────
      case 'leaderboard': {
        const lb = await apiGet('/leaderboard');

        if (!lb || lb.length === 0) {
          await interaction.editReply('🏆 Le leaderboard est vide. Soyez le premier à envoyer quelque chose !');
          return;
        }

        const places = ['🥇', '🥈', '🥉'];
        const list = lb.map((user, i) => {
          const rank = i < 3 ? places[i] : `**#${i + 1}**`;
          return `${rank} **${user.username}** — ${user.totalCount} envois`;
        }).join('\n');

        await interaction.editReply(`🏆 **TOP 10 SPAMMEURS BORDELBOX** 🏆\n\n${list}`);
        break;
      }

      // ── /queue ─────────────────────────────────────────
      case 'queue': {
        const target = interaction.options.getString('cible');

        const data = await apiGet('/queue');
        const queues = Object.entries(data);

        if (queues.length === 0 || queues.every(([_, q]) => q.length === 0)) {
          await interaction.editReply('📭 La file d\'attente globale est vide.');
          return;
        }

        if (target) {
          const q = data[target];
          if (!q || q.length === 0) {
            await interaction.editReply(`📭 La file d'attente de **${target}** est vide.`);
            return;
          }

          let msg = `⏳ **File d'attente de ${target}** (${q.length} élément${q.length > 1 ? 's' : ''}) :\n`;
          q.slice(0, 10).forEach((item, i) => {
            const typeEmoji = item.type === 'message' ? '💬' : (item.payload?.fileType === 'audio' ? '🎵' : '🎬');
            const sender = item.payload?.senderName || 'Système';
            let preview = item.type === 'message' ? item.payload?.text : (item.payload?.caption || 'Média');
            if (preview && preview.length > 30) preview = preview.substring(0, 30) + '…';
            msg += `\`#${i + 1}\` ${typeEmoji} de **${sender}** : *${preview}*\n`;
          });
          if (q.length > 10) msg += `*... et ${q.length - 10} autres*`;

          // Création des boutons de gestion
          const row = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`skip_${target}`)
                .setLabel('Voter pour Skip l\'actuel')
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(`clear_${target}`)
                .setLabel('Vider sa file')
                .setStyle(ButtonStyle.Danger)
            );

          await interaction.editReply({ content: msg, components: [row] });
        } else {
          let msg = `⏳ **Files d'attente globales** :\n\n`;
          queues.forEach(([pseudo, q]) => {
            if (q.length > 0) {
              msg += `**${pseudo}** : ${q.length} élément${q.length > 1 ? 's' : ''}\n`;
            }
          });
          msg += `\n*Utilisez \`/queue @utilisateur\` pour voir les détails et gérer sa file.*`;
          await interaction.editReply(msg);
        }
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
        const userId     = interaction.user.id;

        const data = await apiPost('/message', { text, target, senderName, avatarUrl, ttsVoice, greenscreen, userId });

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
