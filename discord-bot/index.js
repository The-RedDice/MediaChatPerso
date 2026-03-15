/**
 * BordelBox Discord Bot
 * Discord.js v14 — Slash Commands + Rich Presence dynamique
 */

'use strict';

require('dotenv').config({ path: '../.env' });

const { Client, GatewayIntentBits, Events, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
// fetch est natif depuis Node.js 18 — pas besoin de node-fetch

// ─── Config ──────────────────────────────────────────────

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const TOKEN      = process.env.DISCORD_TOKEN;
const REPUTATION_CHANNEL_ID = process.env.REPUTATION_CHANNEL_ID;

if (!TOKEN) {
  console.error('❌  DISCORD_TOKEN manquant dans .env');
  process.exit(1);
}

// ─── Client Discord ──────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ─── Helpers API ─────────────────────────────────────────

function getAuthHeader() {
  const panelPassword = process.env.PANEL_PASSWORD || 'changeme';
  const credentials = Buffer.from(`admin:${panelPassword}`).toString('base64');
  return { 'Authorization': `Basic ${credentials}` };
}

async function apiPost(endpoint, body) {
  const res = await fetch(`${SERVER_URL}/api${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader()
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiGet(endpoint) {
  const res = await fetch(`${SERVER_URL}/api${endpoint}`, {
    headers: { ...getAuthHeader() }
  });
  return res.json();
}

async function apiDelete(endpoint) {
  const res = await fetch(`${SERVER_URL}/api${endpoint}`, {
    method: 'DELETE',
    headers: { ...getAuthHeader() }
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

// ─── Fonction de log de réputation ───────────────────────

async function sendReputationLog(interaction, title, description, thumbnail) {
  if (!REPUTATION_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(REPUTATION_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;

    // Use message ID to uniquely track votes
    const messageId = Date.now().toString() + Math.floor(Math.random() * 1000);

    const embed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle(title)
      .setDescription(description)
      .setAuthor({ name: interaction.user.displayName || interaction.user.username, iconURL: interaction.user.displayAvatarURL({ size: 64, extension: 'png' }) })
      .setFooter({ text: `Réputation: 0` });

    if (thumbnail) embed.setThumbnail(thumbnail);

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`rep_up_${interaction.user.id}_${messageId}`)
          .setLabel('👍 Upvote')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`rep_down_${interaction.user.id}_${messageId}`)
          .setLabel('👎 Downvote')
          .setStyle(ButtonStyle.Danger),
      );

    await channel.send({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error('[Reputation] Erreur envoi log:', err);
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

    if (customId === 'btn_color') {
      const modal = new ModalBuilder()
        .setCustomId('modal_color')
        .setTitle('Couleur personnalisée');

      const colorInput = new TextInputBuilder()
        .setCustomId('color_input')
        .setLabel("Couleur Hexadécimale (ex: #FF0000)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("#FF0000 ou red")
        .setRequired(false);

      const actionRow = new ActionRowBuilder().addComponents(colorInput);
      modal.addComponents(actionRow);

      await interaction.showModal(modal);
      return;
    }


    // Gérer les boutons de réputation
    if (customId.startsWith('rep_up_') || customId.startsWith('rep_down_')) {
      const parts = customId.split('_');
      const action = parts[1]; // 'up' ou 'down'
      const authorId = parts[2];
      const messageId = parts[3];

      if (interaction.user.id === authorId) {
        await interaction.reply({ content: '❌ Tu ne peux pas voter pour ton propre média !', ephemeral: true });
        return;
      }

      const value = action === 'up' ? 1 : -1;
      const voterId = interaction.user.id;

      try {
        // Obtenir le username de l'auteur d'origine depuis le message si possible, ou via une mention.
        // Ici l'auteur du post dans le salon REPUTATION_CHANNEL_ID est toujours le bot,
        // mais on peut extraire le nom de l'embed author.
        let authorUsername = authorId;
        const embed = interaction.message.embeds[0];
        if (embed && embed.author && embed.author.name) {
            authorUsername = embed.author.name;
        }

        const res = await apiPost('/reputation', {
          targetId: authorId,
          targetUsername: authorUsername,
          value,
          voterId,
          messageId
        });

        if (res && res.ok) {
          // Mise à jour de l'embed pour afficher le nouveau score
          if (embed) {
            const newEmbed = EmbedBuilder.from(embed).setFooter({ text: `Réputation: ${res.newScore > 0 ? '+' : ''}${res.newScore}` });
            await interaction.update({ embeds: [newEmbed] });
          } else {
            await interaction.reply({ content: `✅ Vote enregistré ! (${res.newScore > 0 ? '+' : ''}${res.newScore})`, ephemeral: true });
          }
        } else {
          await interaction.reply({ content: `❌ Erreur : ${res.error}`, ephemeral: true });
        }
      } catch (err) {
        let errMsg = 'Erreur serveur.';
        if (err.message && err.message.includes('déjà voté')) errMsg = 'Tu as déjà voté pour ce message.';
        await interaction.reply({ content: `❌ ${errMsg}`, ephemeral: true });
      }
      return;
    }

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

  if (interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
    const customId = interaction.customId;
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;

    let payload = { username };

    if (interaction.isStringSelectMenu()) {
      const selectedValue = interaction.values[0] === 'default' ? null : interaction.values[0];
      if (customId === 'select_font') payload.font = selectedValue;
      if (customId === 'select_anim') payload.animation = selectedValue;
      if (customId === 'select_effect') payload.effect = selectedValue;
    } else if (interaction.isModalSubmit() && customId === 'modal_color') {
      let colorValue = interaction.fields.getTextInputValue('color_input').trim();
      payload.color = colorValue || null;
    }

    try {
      await apiPost(`/style/${userId}`, payload);

      const data = await apiGet(`/style/${userId}`);
      const p = data.profile || {};

      let msg = `🎨 **Configuration de votre profil visuel**\n\n`;
      msg += `> **Couleur** : \`${p.color || 'Par défaut'}\`\n`;
      msg += `> **Police** : \`${p.font || 'Par défaut'}\`\n`;
      msg += `> **Animation** : \`${p.animation || 'Par défaut'}\`\n`;
      msg += `> **Effet** : \`${p.effect || 'Aucun'}\`\n\n`;
      msg += `✅ Modification enregistrée !`;

      if (interaction.isModalSubmit()) {
        await interaction.update({ content: msg });
      } else {
        await interaction.update({ content: msg });
      }
    } catch (err) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: `❌ Erreur : Impossible de sauvegarder le style.` });
      } else {
        await interaction.reply({ content: `❌ Erreur : Impossible de sauvegarder le style.`, ephemeral: true });
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // Réponse différée pour les commandes longues
  if (commandName === 'sendurl' || commandName === 'sendfile' || commandName === 'message' || commandName === 'online' || commandName === 'stats' || commandName === 'leaderboard' || commandName === 'queue' || commandName === 'download') {
    await interaction.deferReply();
  } else if (commandName === 'tuto' || commandName === 'style' || commandName === 'upload') {
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
        const filter = interaction.options.getString('filtre') || '';

        const senderName = interaction.user.displayName || interaction.user.username;
        const avatarUrl  = interaction.user.displayAvatarURL({ size: 64, extension: 'png' });
        const userId     = interaction.user.id;

        // Récupérer le profil et override
        const profileData = await apiGet(`/style/${userId}`);
        const profile = profileData.profile || {};
        const color = interaction.options.getString('couleur') || profile.color;
        const font = interaction.options.getString('police') || profile.font;
        const animation = interaction.options.getString('animation') || profile.animation;
        const effect = interaction.options.getString('effet') || profile.effect;

        await interaction.editReply({
          content: `⏳ Traitement de \`${url}\` en cours…`,
        });

        const data = await apiPost('/sendurl', { url, target, caption, senderName, avatarUrl, ttsVoice, greenscreen, filter, userId, color, font, animation, effect });

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
        await sendReputationLog(interaction, 'Nouveau Lien Envoyé', `**Cible :** ${target === 'all' ? 'Tout le monde' : target}\n**Lien :** ${url}\n**Texte :** ${caption || '*Aucun*'}`);
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
        const filter = interaction.options.getString('filtre') || '';

        if (attachment.size > 250 * 1024 * 1024) {
          await interaction.editReply(`❌ Erreur : Le fichier dépasse la limite de 250 Mo.`);
          return;
        }

        const senderName = interaction.user.displayName || interaction.user.username;
        const avatarUrl  = interaction.user.displayAvatarURL({ size: 64, extension: 'png' });
        const userId     = interaction.user.id;

        // Récupérer le profil et override
        const profileData = await apiGet(`/style/${userId}`);
        const profile = profileData.profile || {};
        const color = interaction.options.getString('couleur') || profile.color;
        const font = interaction.options.getString('police') || profile.font;
        const animation = interaction.options.getString('animation') || profile.animation;
        const effect = interaction.options.getString('effet') || profile.effect;

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

        const data = await apiPost('/sendfile', { fileUrl, fileType, target, caption, senderName, avatarUrl, ttsVoice, greenscreen, filter, userId, color, font, animation, effect });

        if (data.error) {
          await interaction.editReply(`❌ Erreur : ${data.error}`);
          return;
        }

        await interaction.editReply(
          `✅ Fichier (${fileType}) envoyé à **${target === 'all' ? 'tout le monde' : target}** !` +
          (caption ? `\n💬 Caption : "${caption}"` : '')
        );
        await sendReputationLog(interaction, 'Nouveau Fichier Envoyé', `**Cible :** ${target === 'all' ? 'Tout le monde' : target}\n**Type :** ${fileType}\n**Texte :** ${caption || '*Aucun*'}`, attachment.url);
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

        const totalMedia = (data.mediaCount || 0) + (data.fileCount || 0);
        const flops = data.skippedCount || 0;

        const rankMediaStr = data.rankMedia ? ` *(#${data.rankMedia})*` : '';
        const rankFlopStr = data.rankFlop ? ` *(#${data.rankFlop})*` : '';

        const msg = `📊 **Statistiques de ${data.username}** :\n` +
          `• Médias envoyés : **${totalMedia}**${rankMediaStr}\n` +
          `• Médias flop (skip) : **${flops}**${rankFlopStr}\n` +
          `• Total envoyé : ${data.totalCount} (incl. messages texte)\n` +
          `• Dernière activité : <t:${Math.floor(data.lastAction / 1000)}:R>`;

        await interaction.editReply(msg);
        break;
      }

      // ── /leaderboard ───────────────────────────────────
      case 'leaderboard': {
        const type = interaction.options.getString('type') || 'media';
        const lb = await apiGet(`/leaderboard?type=${type}`);

        if (!lb || lb.length === 0) {
          await interaction.editReply('🏆 Le leaderboard est vide.');
          return;
        }

        const places = ['🥇', '🥈', '🥉'];
        const list = lb.map((user, i) => {
          const rank = i < 3 ? places[i] : `**#${i + 1}**`;
          let valueStr = '';
          if (type === 'flop') {
            valueStr = `${user.skippedCount || 0} flops`;
          } else if (type === 'rep') {
            valueStr = `${user.reputation || 0} réputation`;
          } else {
            const totalMedia = (user.mediaCount || 0) + (user.fileCount || 0);
            valueStr = `${totalMedia} médias`;
          }
          return `${rank} **${user.username}** — ${valueStr}`;
        }).join('\n');

        let title = '🏆 **TOP MÉDIAS BORDELBOX** 🏆';
        if (type === 'flop') title = '🏆 **TOP FLOP BORDELBOX (Médias Skippés)** 🏆';
        if (type === 'rep') title = '🏆 **TOP RÉPUTATION BORDELBOX** 🏆';
        await interaction.editReply(`${title}\n\n${list}`);
        break;
      }

      // ── /style ─────────────────────────────────────────
      case 'style': {
        const userId = interaction.user.id;
        const data = await apiGet(`/style/${userId}`);
        const p = data.profile || {};

        let msg = `🎨 **Configuration de votre profil visuel**\n\n`;
        msg += `> **Couleur** : \`${p.color || 'Par défaut'}\`\n`;
        msg += `> **Police** : \`${p.font || 'Par défaut'}\`\n`;
        msg += `> **Animation** : \`${p.animation || 'Par défaut'}\`\n`;
        msg += `> **Effet** : \`${p.effect || 'Aucun'}\`\n\n`;
        msg += `Utilisez les menus ci-dessous pour modifier votre style :`;

        const fontMenu = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('select_font')
            .setPlaceholder('Choisir une police...')
            .addOptions([
              { label: 'Par défaut', value: 'default' },
              { label: 'Pixel (Retro)', value: '"Press Start 2P"' },
              { label: 'Horreur', value: 'Creepster' },
              { label: 'Impact (Meme)', value: 'Impact' },
              { label: 'Comic Sans MS (Troll)', value: '"Comic Sans MS"' },
              { label: 'Courier New (Machine à écrire)', value: '"Courier New"' },
              { label: 'Arial (Classique)', value: 'Arial' },
              { label: 'Georgia (Sérieux)', value: 'Georgia' },
              { label: 'Trebuchet MS', value: '"Trebuchet MS"' }
            ])
        );

        const animMenu = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('select_anim')
            .setPlaceholder('Choisir une animation...')
            .addOptions([
              { label: 'Par défaut', value: 'default' },
              { label: 'Glitch', value: 'glitch' },
              { label: 'Machine à écrire', value: 'typewriter' },
              { label: 'Pulse', value: 'pulse' },
              { label: 'Fondu (Fade)', value: 'fade' },
              { label: 'Glissement (Slide)', value: 'slide' },
              { label: 'Rebond (Bounce)', value: 'bounce' },
              { label: 'Zoom', value: 'zoom' },
              { label: 'Rotation (Spin)', value: 'spin' },
              { label: 'Tremblement (Shake)', value: 'shake' },
              { label: 'Chute (Drop)', value: 'drop' }
            ])
        );

        const effectMenu = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('select_effect')
            .setPlaceholder('Choisir un effet visuel...')
            .addOptions([
              { label: 'Aucun', value: 'aucun' },
              { label: 'Neige', value: 'neige' },
              { label: 'Cœurs', value: 'coeurs' },
              { label: 'Matrix', value: 'matrix' },
              { label: 'Particules', value: 'particules' },
              { label: 'Étoiles', value: 'etoiles' },
              { label: 'Confettis', value: 'confetti' },
              { label: 'Feu', value: 'feu' }
            ])
        );

        const colorBtnRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('btn_color')
            .setLabel('Modifier la Couleur')
            .setStyle(ButtonStyle.Primary)
        );

        await interaction.editReply({
          content: msg,
          components: [fontMenu, animMenu, effectMenu, colorBtnRow]
        });
        break;
      }

      // ── /queue ─────────────────────────────────────────
      case 'queue': {
        const targetUser = interaction.options.getUser('cible');
        const target = targetUser ? targetUser.username : null;

        const data = await apiGet('/queue');
        const queues = Object.entries(data);

        if (queues.length === 0 || queues.every(([_, q]) => q.length === 0)) {
          const embed = new EmbedBuilder()
            .setColor(0x36393F)
            .setDescription('📭 **La file d\'attente globale est totalement vide.**');
          await interaction.editReply({ embeds: [embed] });
          return;
        }

        const formatItem = (item, index) => {
          let typeEmoji = item.type === 'message' ? '💬' : (item.payload?.fileType === 'audio' ? '🎵' : (item.payload?.fileType === 'image' ? '🖼️' : '🎬'));
          const sender = item.payload?.senderName || 'Système';
          let preview = item.type === 'message' ? item.payload?.text : (item.payload?.caption || '*Sans texte*');
          if (preview && preview.length > 40) preview = preview.substring(0, 40) + '…';

          let extras = [];
          if (item.payload?.ttsUrl) extras.push('🎙️ TTS');
          if (item.payload?.greenscreen) extras.push('🟩 GS');
          const extrasStr = extras.length > 0 ? ` [${extras.join(', ')}]` : '';

          return `\`#${index + 1}\` ${typeEmoji} par **${sender}** : ${preview}${extrasStr}`;
        };

        if (target) {
          const q = data[target];
          if (!q || q.length === 0) {
            const embed = new EmbedBuilder()
              .setColor(0x36393F)
              .setDescription(`📭 La file d'attente de **${target}** est vide.`);
            await interaction.editReply({ embeds: [embed] });
            return;
          }

          const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`⏳ File d'attente : ${target}`)
            .setDescription(`Il y a **${q.length}** élément(s) en attente pour ce PC.`)
            .setThumbnail(q[0].payload?.avatarUrl || null);

          let listText = q.slice(0, 10).map((item, i) => formatItem(item, i)).join('\n');
          if (q.length > 10) {
            listText += `\n*... et ${q.length - 10} autres éléments.*`;
          }

          embed.addFields({ name: 'Prochains médias', value: listText });

          // Création des boutons de gestion
          const row = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`skip_${target}`)
                .setLabel('Voter pour Skip l\'actuel')
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(`clear_${target}`)
                .setLabel('Vider la file')
                .setStyle(ButtonStyle.Danger)
            );

          await interaction.editReply({ embeds: [embed], components: [row] });
        } else {
          // Vue globale avec le détail de toutes les files actives
          const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('⏳ Files d\'attente globales');

          let hasActiveQueues = false;

          queues.forEach(([pseudo, q]) => {
            if (q.length > 0) {
              hasActiveQueues = true;
              let listText = q.slice(0, 5).map((item, i) => formatItem(item, i)).join('\n');
              if (q.length > 5) listText += `\n*+ ${q.length - 5} autres...*`;

              embed.addFields({ name: `🖥️ ${pseudo} (${q.length})`, value: listText });
            }
          });

          if (!hasActiveQueues) {
            embed.setDescription('Toutes les files sont vides.');
          } else {
             embed.setFooter({ text: 'Astuce : Utilisez /queue [cible] pour interagir avec une file spécifique (Skip/Vider).' });
          }

          await interaction.editReply({ embeds: [embed] });
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

        // Récupérer le profil et override
        const profileData = await apiGet(`/style/${userId}`);
        const profile = profileData.profile || {};
        const color = interaction.options.getString('couleur') || profile.color;
        const font = interaction.options.getString('police') || profile.font;
        const animation = interaction.options.getString('animation') || profile.animation;
        const effect = interaction.options.getString('effet') || profile.effect;

        const data = await apiPost('/message', { text, target, senderName, avatarUrl, ttsVoice, greenscreen, userId, color, font, animation, effect });

        if (data.error) {
          await interaction.editReply(`❌ Erreur : ${data.error}`);
          return;
        }

        await interaction.editReply(
          `💬 Message envoyé à **${target === 'all' ? 'tout le monde' : target}** :\n> ${text}`
        );
        await sendReputationLog(interaction, 'Nouveau Message Envoyé', `**Cible :** ${target === 'all' ? 'Tout le monde' : target}\n**Message :** ${text}`);
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

      // ── /upload ────────────────────────────────────────
      case 'upload': {
        const msg = `🌐 **Page d'Upload Web**\n\n` +
                    `Vous pouvez uploader des fichiers (jusqu'à 250 Mo) directement depuis votre PC sans passer par Discord en utilisant le lien suivant :\n` +
                    `<${SERVER_URL}/upload>\n\n` +
                    `*Une connexion Discord est requise sur le site pour vérifier que vous êtes membre du serveur.*`;

        await interaction.editReply(msg);
        break;
      }

      // ── /download ──────────────────────────────────────
      case 'download': {
        const repoUrl = 'https://api.github.com/repos/The-RedDice/MediaChatPerso/releases/latest';

        try {
          const response = await fetch(repoUrl);
          if (!response.ok) {
             await interaction.editReply('❌ Impossible de récupérer la dernière version (Release introuvable sur GitHub).');
             return;
          }

          const release = await response.json();
          const installer = release.assets.find(a => a.name.endsWith('.exe'));

          if (!installer) {
             await interaction.editReply(`❌ La dernière version (\`${release.name || release.tag_name}\`) a été trouvée, mais aucun installeur \`.exe\` n'y est attaché.\nLien : <${release.html_url}>`);
             return;
          }

          const msg = `🚀 **Dernière version de BordelBox Client** (\`${release.name || release.tag_name}\`)\n\n` +
                      `⬇️ **Télécharger l'installeur :**\n<${installer.browser_download_url}>\n\n` +
                      `*Notes de version :* <${release.html_url}>`;

          await interaction.editReply(msg);
        } catch (err) {
          console.error('[Download error]', err);
          await interaction.editReply('❌ Erreur lors de la communication avec l\'API GitHub.');
        }
        break;
      }

      // ── /tuto ──────────────────────────────────────────
      case 'tuto': {
        const tutoMessage = `
**Bienvenue sur BordelBox ! 🗃️**

BordelBox est un système permettant d'afficher des médias et des messages en direct sur les écrans des ordinateurs connectés via l'overlay client.

**💻 Commandes d'envoi :**
\` /sendurl \` : Envoie une vidéo YouTube, TikTok ou un lien direct (mp4, mp3, image) sur les PC.
\` /sendfile \` : Permet d'uploader directement un fichier (image, vidéo, audio) depuis Discord.
\` /message \` : Affiche un gros texte animé sur les écrans.

**⚙️ Options des commandes d'envoi :**
- **cible** : Permet de choisir un PC spécifique. Si vide, l'envoi se fait sur tous les PC.
- **text** / **texte** : Un texte d'accompagnement.
- **tts** : Génère une voix (Text-to-Speech) qui lit votre texte en même temps (ex: "mario").
- **greenscreen** : Active un filtre d'incrustation (fond vert) pour rendre le fond transparent.
- **couleur / police / animation / effet** : Modifie temporairement l'apparence visuelle.

**📊 Utilitaires & Infos :**
\` /queue \` : Affiche et gère la file d'attente (avec des boutons pour vider/skip).
\` /style \` : Menu pour personnaliser votre affichage global (couleur, animation, police, effets).
\` /stats \` : Affiche vos statistiques d'envoi.
\` /leaderboard \` : Affiche le top des spammeurs de la BordelBox.
\` /online \` : Liste les PC actuellement connectés.
\` /upload \` : Obtient le lien de la page web pour envoyer des fichiers lourds hors-discord.
\` /download \` : Télécharge la dernière version du client BordelBox (depuis GitHub).
\` /tuto \` : Affiche ce message d'aide.
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
