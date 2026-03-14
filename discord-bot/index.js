/**
 * Cacabox Discord Bot
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
  if (commandName === 'sendurl') {
    await interaction.deferReply();
  } else {
    await interaction.deferReply({ ephemeral: true });
  }

  try {
    switch (commandName) {

      // ── /sendurl ───────────────────────────────────────
      case 'sendurl': {
        const url     = interaction.options.getString('lien', true);
        const target  = interaction.options.getString('cible')   || 'all';
        const caption = interaction.options.getString('text') || '';
        const ttsVoice = interaction.options.getString('tts') || '';
        const greenscreen = interaction.options.getBoolean('greenscreen') || false;

        const senderName = interaction.user.displayName || interaction.user.username;
        const avatarUrl  = interaction.user.displayAvatarURL({ size: 64, extension: 'png' });

        await interaction.editReply({
          content: `⏳ Téléchargement de \`${url}\` en cours…`,
        });

        const data = await apiPost('/sendurl', { url, target, caption, senderName, avatarUrl, ttsVoice, greenscreen });

        if (data.error) {
          await interaction.editReply(`❌ Erreur : ${data.error}`);
          return;
        }

        await interaction.editReply(
          `✅ Vidéo envoyée à **${target === 'all' ? 'tout le monde' : target}** !\n` +
          `📁 Fichier : \`${data.filename}\`` +
          (caption ? `\n💬 Caption : "${caption}"` : '')
        );
        updatePresence();
        break;
      }

      // ── /sendfile ──────────────────────────────────────
      case 'sendfile': {
        const attachment = interaction.options.getAttachment('fichier', true);
        const target     = interaction.options.getString('cible')   || 'all';
        const caption    = interaction.options.getString('text') || '';
        const ttsVoice = interaction.options.getString('tts') || '';
        const greenscreen = interaction.options.getBoolean('greenscreen') || false;

        const senderName = interaction.user.displayName || interaction.user.username;
        const avatarUrl  = interaction.user.displayAvatarURL({ size: 64, extension: 'png' });

        const fileUrl  = attachment.url;
        const fileType = attachment.contentType?.startsWith('audio') ? 'audio' : 'image';

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
        const target = interaction.options.getString('cible') || 'all';
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

      default:
        await interaction.editReply('❓ Commande inconnue.');
    }
  } catch (err) {
    console.error(`[Bot Error] ${commandName}:`, err.message);
    const msg = `❌ Impossible de contacter le serveur Cacabox.\n\`${err.message}\``;
    if (interaction.deferred) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});

// ─── Connexion ───────────────────────────────────────────

client.login(TOKEN);
