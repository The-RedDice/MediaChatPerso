/**
 * BordelBox Discord Bot
 * Discord.js v14 — Slash Commands + Rich Presence dynamique
 */

'use strict';

require('dotenv').config({ path: '../.env' });

const { Client, GatewayIntentBits, Events, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const io = require('socket.io-client');
// fetch est natif depuis Node.js 18 — pas besoin de node-fetch

// ─── Config ──────────────────────────────────────────────

const PORT       = process.env.PORT || 3000;
const SERVER_URL = (process.env.SERVER_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const TOKEN      = process.env.DISCORD_TOKEN;
const REPUTATION_CHANNEL_ID = process.env.REPUTATION_CHANNEL_ID;

console.log(`[BordelBox Bot] SERVER_URL configuré sur : ${SERVER_URL}`);

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
    const res = await apiGet('/clients');
    if (res.error) {
       console.error(`[Presence] Erreur API : ${res.error}`);
       throw new Error(res.error);
    }
    const count = Array.isArray(res.clients) ? res.clients.length : 0;

    client.user.setPresence({
      activities: [{
        name: count === 0
          ? 'Aucune victime connectée 😴'
          : `${count} PC${count > 1 ? 's' : ''} sous surveillance 👁️`,
        type: ActivityType.Watching,
      }],
      status: count === 0 ? 'idle' : 'online',
    });
  } catch (err) {
    console.error(`[Presence] Serveur inaccessible à ${SERVER_URL}/api/clients :`, err.message);
    client.user.setPresence({
      activities: [{ name: 'Serveur inaccessible ⚠️', type: ActivityType.Watching }],
      status: 'dnd',
    });
  }
}

// ─── Fonction de log de réputation ───────────────────────

async function sendReputationLog(interaction, title, description, thumbnail, memeData = null) {
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
      .setFooter({ text: `BordelCoins: 0` });

    if (thumbnail) embed.setThumbnail(thumbnail);

    const actionComponents = [
      new ButtonBuilder()
        .setCustomId(`rep_up_${interaction.user.id}_${messageId}`)
        .setLabel('👍 Upvote')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`rep_down_${interaction.user.id}_${messageId}`)
        .setLabel('👎 Downvote')
        .setStyle(ButtonStyle.Danger),
    ];

    // Ajouter un bouton pour sauvegarder le mème si les données sont fournies (médias/fichiers, pas messages texte purs)
    if (memeData) {
       // On encode les données du meme dans le footer de l'embed car le customId est limité à 100 char.
       // On le met sous forme JSON invisible ou juste on laisse un flag dans le customId et on reconstruit à partir de la description.
       // Pour être fiable, on ajoute l'URL dans le footer ou un champ caché, ou on encode en base64 un objet léger si possible.
       // Comme c'est trop long pour customId, on va créer une map temporaire en RAM ou extraire depuis l'embed lors du clic.
       // Le plus simple : on met l'URL dans un champ de l'embed.
       embed.addFields({ name: 'URL Média (Caché)', value: memeData.url || 'Aucune URL' });
       // Note : Discord UI ne permet pas vraiment de champs "cachés".
       // On peut aussi stocker l'URL en base64 dans le customId si c'est court, ou se fier à description/thumbnail.
       // Plutôt que d'afficher l'URL, on utilise un cache en RAM, ou on l'extrait de la description si présente.

       actionComponents.push(
         new ButtonBuilder()
          .setCustomId(`meme_save_${messageId}`)
          .setLabel('💾 Mème')
          .setStyle(ButtonStyle.Secondary)
       );

       // On enregistre les infos du meme associées au messageId pour la session courante du bot.
       // En cas de redémarrage, on ne pourra plus sauvegarder les anciens mèmes, mais ce n'est pas critique.
       memeDataCache.set(messageId, memeData);
    }

    const row = new ActionRowBuilder().addComponents(actionComponents);

    await channel.send({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error('[Reputation] Erreur envoi log:', err);
  }
}

// Cache temporaire pour stocker les données du mème associées à un message de réputation
const memeDataCache = new Map();

// ─── Ready ───────────────────────────────────────────────

client.once(Events.ClientReady, async (c) => {
  console.log(`\n✅  Bot connecté : ${c.user.tag}`);
  await updatePresence();
  // Rafraîchit la présence toutes les 30 secondes
  setInterval(updatePresence, 30_000);

  // Connect to the Socket.io server to listen for draw results
  const socket = io(SERVER_URL);

  socket.on('connect', () => {
    console.log('[Bot] Connecté au serveur Socket.io pour les événements.');
  });

  socket.on('discord_draw_result', async (data) => {
    const { target, fileUrl } = data;
    if (!REPUTATION_CHANNEL_ID) return;

    try {
      const channel = await client.channels.fetch(REPUTATION_CHANNEL_ID);
      if (!channel || !channel.isTextBased()) return;

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🖌️ Fin de session de dessin !')
        .setDescription(`Le dessin en direct sur l'écran de **${target}** est terminé. Voici l'œuvre :`)
        .setImage('attachment://draw.png');

      const attachment = new AttachmentBuilder(fileUrl, { name: 'draw.png' });

      await channel.send({ embeds: [embed], files: [attachment] });
    } catch (err) {
      console.error('[Bot Draw Result] Erreur envoi channel:', err);
    }
  });
});

// ─── Gestion des interactions ────────────────────────────

async function checkUserNotifications(interaction, userId) {
  try {
    const res = await apiGet(`/notifications/${userId}`);
    if (res && res.notifications && res.notifications.length > 0) {
      let msg = "🎉 **BordelBox - Récompenses Journalières !** 🎉\n\nFélicitations, tu as terminé dans le **Top 3** hier !\n\n";

      let totalCoins = 0;
      let totalLootboxes = 0;

      res.notifications.forEach(n => {
        msg += `🏆 **#${n.rank}** en *${n.category}* (Score: ${n.score})\n`;
        if (n.coins > 0) { msg += `└ 💰 +${n.coins} BordelCoins\n`; totalCoins += n.coins; }
        if (n.lootbox > 0) { msg += `└ 🎁 +${n.lootbox} Lootbox(es)\n`; totalLootboxes += n.lootbox; }
        msg += "\n";
      });

      msg += `**Total gagné :** ${totalCoins} 💰` + (totalLootboxes > 0 ? ` et ${totalLootboxes} 🎁` : "");

      await interaction.followUp({ content: msg, flags: [MessageFlags.Ephemeral] });
    }
  } catch (err) {
    console.error("[Notifications] Erreur de récupération :", err);
  }
}

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
        await interaction.reply({ content: '❌ Tu ne peux pas voter pour ton propre média !', flags: [MessageFlags.Ephemeral] });
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
            const newEmbed = EmbedBuilder.from(embed).setFooter({ text: `BordelCoins: ${res.newScore > 0 ? '+' : ''}${res.newScore}` });
            await interaction.update({ embeds: [newEmbed] });
          } else {
            await interaction.reply({ content: `✅ Vote enregistré ! (${res.newScore > 0 ? '+' : ''}${res.newScore})`, flags: [MessageFlags.Ephemeral] });
          }
          await checkUserNotifications(interaction, voterId);
        } else {
          await interaction.reply({ content: `❌ Erreur : ${res.error}`, flags: [MessageFlags.Ephemeral] });
        }
      } catch (err) {
        let errMsg = 'Erreur serveur.';
        if (err.message && err.message.includes('déjà voté')) errMsg = 'Tu as déjà voté pour ce message.';
        await interaction.reply({ content: `❌ ${errMsg}`, flags: [MessageFlags.Ephemeral] });
      }
      return;
    }

    if (customId.startsWith('trade_')) {
      const parts = customId.split('_');
      const action = parts[1]; // accept or decline
      const tradeId = parts.slice(2).join('_');

      try {
        if (action === 'accept') {
          const res = await apiPost('/trade/accept', { tradeId, userId: interaction.user.id });
          if (res.error) {
            await interaction.reply({ content: `❌ Erreur : ${res.error}`, flags: [MessageFlags.Ephemeral] });
          } else {
             const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x00FF00).setTitle('✅ Échange accepté et terminé').setDescription('Les objets ont été transférés.');
             await interaction.update({ embeds: [newEmbed], components: [] });
          }
        } else if (action === 'decline') {
           await apiPost('/trade/decline', { tradeId, userId: interaction.user.id });
           const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xFF0000).setTitle('❌ Échange refusé / annulé');
           await interaction.update({ embeds: [newEmbed], components: [] });
        } else if (action === 'propose') {
           // Show modal to propose items and coins
           const modal = new ModalBuilder()
             .setCustomId(`trade_modal_${tradeId}`)
             .setTitle('Proposer des objets');

           const itemInput = new TextInputBuilder()
             .setCustomId('trade_item_input')
             .setLabel("ID de l'objet (un seul pour l'instant)")
             .setStyle(TextInputStyle.Short)
             .setRequired(false);

           const coinInput = new TextInputBuilder()
             .setCustomId('trade_coin_input')
             .setLabel("Montant en pièces")
             .setStyle(TextInputStyle.Short)
             .setRequired(false);

           modal.addComponents(
             new ActionRowBuilder().addComponents(itemInput),
             new ActionRowBuilder().addComponents(coinInput)
           );

           await interaction.showModal(modal);
        }
      } catch(err) {
         await interaction.reply({ content: `❌ Erreur lors de l'échange.`, flags: [MessageFlags.Ephemeral] });
      }
      return;
    }

    // Gérer le bouton de sauvegarde de mème
    if (customId.startsWith('meme_save_')) {
      const messageId = customId.replace('meme_save_', '');
      const memeData = memeDataCache.get(messageId);

      if (!memeData) {
        await interaction.reply({ content: '❌ Impossible de retrouver les données de ce mème. Veuillez renvoyer le média.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`modal_meme_${messageId}`)
        .setTitle('Sauvegarder ce Mème');

      const nameInput = new TextInputBuilder()
        .setCustomId('meme_name_input')
        .setLabel("Nom du mème")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: wtf, wow, mario...")
        .setMaxLength(50)
        .setRequired(true);

      const actionRow = new ActionRowBuilder().addComponents(nameInput);
      modal.addComponents(actionRow);

      await interaction.showModal(modal);
      return;
    }

    // Gérer les interactions Boss
    if (customId.startsWith('event_boss_hit_')) {
      const eventId = customId.replace('event_boss_hit_', '');

      try {
        const username = interaction.member?.displayName || interaction.user.username;
        const res = await apiPost('/event/interact', { eventId, userId: interaction.user.id, username });
        if (res.error) {
          await interaction.reply({ content: `❌ ${res.error}`, flags: [MessageFlags.Ephemeral] });
        } else {
          // Silent acknowledgment to prevent spam
          await interaction.deferUpdate();

          if (res.defeated) {
            // Check if user got rewards for their personal notification
            let userRewardMsg = '';
            if (res.participantsStats) {
              const userStats = res.participantsStats.find(p => p.userId === interaction.user.id);
              if (userStats && userStats.reward > 0) {
                userRewardMsg = `💰 **${username}**, tu as gagné **${userStats.reward} BordelCoins** (${userStats.percent}% des dégâts) !`;
              } else {
                userRewardMsg = `*(**${username}**, tu n'as pas gagné de BordelCoins car ton overlay n'était pas connecté.)*`;
              }
              if (userStats && userStats.gotLootbox) {
                userRewardMsg += `\n🎁 **ET UNE LOOTBOX OBTENUE !** 🎉 Utilise \`/lootbox open\` !`;
              }
              // Send the personal reward notification as an ephemeral follow-up
              await interaction.followUp({ content: `🎉 **LE BOSS EST VAINCU !**\n${userRewardMsg}`, flags: [MessageFlags.Ephemeral] });
            }

            // Broadcast the public notification in the channel
            const channel = interaction.channel;
            if (channel) {
              const embed = new EmbedBuilder()
                .setColor(0xED4245)
                .setTitle('🎉 LE BOSS EST VAINCU ! 🎉')
                .setDescription(`Le Boss a été terrassé grâce à l'effort combiné de nos héros !\n**Cagnotte totale : ${res.prizePool} pièces**`)
                .setThumbnail('https://cdn-icons-png.flaticon.com/512/1004/1004305.png');

              let participantsList = '';
              if (res.participantsStats && res.participantsStats.length > 0) {
                // Top 3 gets special medals
                const medals = ['🥇', '🥈', '🥉'];

                const topParticipants = res.participantsStats.slice(0, 10);

                topParticipants.forEach((p, index) => {
                  const rank = index < 3 ? medals[index] : `**#${index + 1}**`;
                  const lootboxTag = p.gotLootbox ? " 🎁" : "";
                  participantsList += `${rank} **${p.username}** — ${p.damage} dégâts (${p.percent}%) ➡️ **+${p.reward} pièces**${lootboxTag}\n`;
                });

                if (res.participantsStats.length > 10) {
                  participantsList += `\n*... et ${res.participantsStats.length - 10} autres héros ont combattu !*`;
                }
              } else {
                participantsList = '*Aucun héros n\'a survécu pour réclamer la prime...*';
              }

              embed.addFields({ name: '🏆 Tableau des scores', value: participantsList });

              await channel.send({ embeds: [embed] });

              // We try to delete the original message that contains the boss
              if (interaction.message && interaction.message.deletable) {
                try {
                  await interaction.message.delete();
                } catch (e) {
                  console.error('[Event] Impossible de supprimer le message de boss', e);
                }
              }

            }

          }
        }
      } catch (err) {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.reply({ content: `❌ Erreur de connexion au serveur.`, flags: [MessageFlags.Ephemeral] });
        }
      }
      return;
    }

    // Gérer les interactions Sondage
    if (customId.startsWith('event_sondage_vote_')) {
      const parts = customId.split('_');
      const choiceIndex = parseInt(parts.pop(), 10);
      const eventId = parts.slice(3).join('_'); // recomposer event_id s'il contenait des underscores

      try {
        const res = await apiPost('/event/interact', { eventId, userId: interaction.user.id, choiceIndex });
        if (res.error) {
          await interaction.reply({ content: `❌ ${res.error}`, flags: [MessageFlags.Ephemeral] });
        } else {
          await interaction.reply({ content: `✅ Ton vote a été enregistré !`, flags: [MessageFlags.Ephemeral] });
        }
      } catch (err) {
        await interaction.reply({ content: `❌ Erreur de connexion au serveur.`, flags: [MessageFlags.Ephemeral] });
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
        await interaction.reply({ content: `❌ Erreur lors du vidage de la file.`, flags: [MessageFlags.Ephemeral] });
      }
    } else
    // --- Coinflip Buttons ---
    if (customId.startsWith('cf_accept_') || customId.startsWith('cf_decline_')) {
      const isAccept = customId.startsWith('cf_accept_');
      const flipId = customId.replace('cf_accept_', '').replace('cf_decline_', '');

      if (!isAccept) {
        await apiPost('/coinflip/cancel', { flipId });
        await interaction.update({ content: 'Pari refusé ou annulé.', embeds: [], components: [] });
        return;
      }

      const res = await apiPost('/coinflip/accept', { flipId, userId: interaction.user.id });
      if (!res || res.error) {
        await interaction.reply({ content: '❌ ' + (res?.error || 'Erreur lors de l\'acceptation.'), flags: [MessageFlags.Ephemeral] });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🪙 Résultat du Pile ou Face !')
        .setColor('#e67e22')
        .setDescription(
          `<@${res.winner}> gagne contre <@${res.loser}> !\n\n` +
          `Mise : **${res.amount} BordelCoins**\n` +
          `Gains (après taxe de 5%) : **${res.payout} BordelCoins**\n` +
          `*(Taxe serveur : ${res.tax})*`
        );

      await interaction.update({ content: null, embeds: [embed], components: [] });
      return;
    }

    if (customId.startsWith('roulette_join_')) {
      const rouletteId = customId.replace('roulette_join_', '');
      const res = await apiPost('/roulette/join', { rouletteId, userId: interaction.user.id });
      if (res.error) {
         await interaction.reply({ content: '❌ ' + res.error, flags: [MessageFlags.Ephemeral] });
      } else {
         await interaction.reply({ content: `✅ Tu as rejoint la partie de Roulette (${res.playersCount} joueurs inscrits) !`, flags: [MessageFlags.Ephemeral] });
      }
      return;
    }

    if (customId.startsWith('roulette_draw_yes_') || customId.startsWith('roulette_draw_no_')) {
      const vote = customId.startsWith('roulette_draw_yes_');
      const rouletteId = customId.replace('roulette_draw_yes_', '').replace('roulette_draw_no_', '');
      const res = await apiPost('/roulette/vote', { rouletteId, userId: interaction.user.id, vote });

      if (res.error) {
         await interaction.reply({ content: '❌ ' + res.error, flags: [MessageFlags.Ephemeral] });
         return;
      }

      await interaction.reply({ content: vote ? '✅ Tu as voté pour l\'égalité.' : '🔫 Tu as refusé l\'égalité. Que le bain de sang reprenne !', ephemeral: false });

      if (res.drawAccepted === true) {
         const survivorsStr = res.players.map(id => `<@${id}>`).join(' et ');
         const drawEmbed = new EmbedBuilder()
           .setTitle('🤝 Égalité Acceptée')
           .setColor('#3498db')
           .setDescription(`Les survivants se sont mis d'accord.\n\n${survivorsStr} remportent chacun **${res.payout} BordelCoins** !`);
         await interaction.followUp({ embeds: [drawEmbed], components: [] });
      } else if (res.drawAccepted === false) {
         // One player declined. Resume game.
         let resumeMsg = `<@${interaction.user.id}> a refusé l'égalité !\n\n`;
         if (res.reloaded) {
             resumeMsg += `🔄 **Le fusil était vide ! On recharge : ${res.liveCount} 🔴 et ${res.blankCount} ⚪.**\n\n`;
         } else {
             resumeMsg += `(Il reste ${res.liveCount} 🔴 et ${res.blankCount} ⚪ dans le chargeur)\n\n`;
         }
         resumeMsg += `C'est au tour de <@${res.nextPlayer}> de jouer.`;

         const stateRes = await apiGet(`/roulette/state?rouletteId=${rouletteId}`);
         if (stateRes && stateRes.playerLives) {
             resumeMsg += '\n\n**Vies restantes :**\n';
             for (const [p, lives] of Object.entries(stateRes.playerLives)) {
                if (stateRes.alivePlayers.includes(p)) {
                   resumeMsg += `- <@${p}> : ${'🩷'.repeat(lives)}\n`;
                }
             }
         }

         const turnEmbed = new EmbedBuilder()
             .setTitle('🔫 La partie reprend')
             .setColor('#e74c3c')
             .setDescription(resumeMsg);


           // We need the actual display name. We can fetch it or just use the ping format which doesn't work in select menus.
           // In select menus, <@id> is literally text. We must resolve the user object if possible.
           // Since we can't reliably async-fetch all users in the map, we can rely on interaction.guild.members.cache
           // or just use generic text with the ID if we don't have it.
           // Let's try to fetch members if possible, or fallback to "Joueur".
           const targetOptions = await Promise.all(stateRes.alivePlayers.map(async pId => {
               let displayName = 'Joueur inconnu';
               try {
                   const member = await interaction.guild.members.fetch(pId);
                   displayName = member ? (member.displayName || member.user.username) : pId;
               } catch(e) { displayName = pId; }

               const lives = stateRes.playerLives[pId] || 0;
               const livesText = '🩷'.repeat(lives);

               return {
                   label: pId === stateRes.turnPlayer ? `[TOI] ${displayName} (${livesText})` : `${displayName} (${livesText})`,
                   value: pId,
                   description: pId === stateRes.turnPlayer ? 'Me tirer dessus (Rejoue si ⚪)' : 'Tirer sur cet adversaire'
               };
           }));

           const selectMenu = new StringSelectMenuBuilder()
              .setCustomId('roulette_target_' + rouletteId)
              .setPlaceholder('Choisissez votre cible...')
              .addOptions(targetOptions.slice(0, 25));

           const actionRow = new ActionRowBuilder().addComponents(selectMenu);

         await interaction.followUp({ embeds: [turnEmbed], components: [actionRow] });
      }
      return;
    }

    if (customId.startsWith('arena_accept_') || customId.startsWith('arena_decline_')) {
      const isAccept = customId.startsWith('arena_accept_');
      const arenaId = customId.replace('arena_accept_', '').replace('arena_decline_', '');

      if (!isAccept) {
        await apiPost('/arena/cancel', { arenaId });
        await interaction.update({ content: 'Défi refusé ou annulé.', embeds: [], components: [] });
        return;
      }

      await interaction.reply({ content: `Pour accepter le combat, tu dois choisir ton arme avec la commande : \`/arena accept \${arenaId} <ton_objet>\``, flags: [MessageFlags.Ephemeral] });
      return;
    }

    if (customId.startsWith('skip_')) {
      const target = customId.replace('skip_', '');
      try {
        const res = await apiPost('/voteskip', { voterId: interaction.user.id });
        if (res.skipped) {
          await interaction.reply({ content: `⏩ Vote validé, média en cours pour **${target}** passé !`, ephemeral: false });
        } else {
          await interaction.reply({ content: `🗳️ Vote pour skip enregistré (${res.currentVotes}/${res.requiredVotes}).`, ephemeral: false });
        }
      } catch (err) {
        await interaction.reply({ content: `❌ Erreur lors du skip.`, flags: [MessageFlags.Ephemeral] });
      }
    }
    return;
  }

  if (interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
    const customId = interaction.customId;
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;

    if (customId.startsWith('roulette_target_')) {
        const rouletteId = customId.replace('roulette_target_', '');
        const targetId = interaction.values[0];

        const shootRes = await apiPost('/roulette/shoot', { rouletteId, shooterId: userId, targetId });

        if (shootRes.error) {
            await interaction.reply({ content: '❌ ' + shootRes.error, flags: [MessageFlags.Ephemeral] });
            return;
        }

        // Action was successful, we need to update the game state for everyone.
        // We delete the current component row so no one else can click it.
        await interaction.update({ components: [] });

        const isLive = shootRes.isLive;
        const isSelf = shootRes.isSelf;
        const victimDied = shootRes.victimDied;

        let resultMsg = `<@${userId}> pointe le fusil sur ${isSelf ? '**LUI-MÊME**' : `<@${targetId}>`} et presse la détente...\n\n`;

        const victimLivesRemaining = shootRes.victimLivesRemaining || 0;
        if (isLive) {
            resultMsg += `💥 **BAM ! C'était une vraie balle 🔴 !**\n`;
            if (victimDied) {
               if (isSelf) {
                  resultMsg += `<@${userId}> s'effondre.\n`;
               } else {
                  resultMsg += `<@${targetId}> s'effondre.\n`;
               }
            } else {
               if (isSelf) {
                  resultMsg += `<@${userId}> perd une vie ! (Reste ${victimLivesRemaining} 🩷)\n`;
               } else {
                  resultMsg += `<@${targetId}> perd une vie ! (Reste ${victimLivesRemaining} 🩷)\n`;
               }
            }
        } else {
            resultMsg += `*Clic.* **C'était une balle à blanc ⚪.**\n`;
            if (isSelf) {
               resultMsg += `<@${userId}> sourit. Il gagne un tour supplémentaire !\n`;
            }
        }

        if (shootRes.state === 'finished') {
           const winEmbed = new EmbedBuilder()
             .setTitle('🔫 Fin de la Partie')
             .setColor('#2ecc71')
             .setDescription(resultMsg + `\n🎉 <@${shootRes.winner}> est le dernier survivant et rafle le pactole de **${shootRes.payout} BordelCoins** (Taxe: ${shootRes.tax}) !`);
           await interaction.followUp({ embeds: [winEmbed] });
           return;
        }

        if (shootRes.state === 'draw_proposed') {
           const drawEmbed = new EmbedBuilder()
             .setTitle('🔫 Proposition d\'Égalité')
             .setColor('#f1c40f')
             .setDescription(resultMsg + `\nIl ne reste plus que <@${shootRes.alive[0]}> et <@${shootRes.alive[1]}> en vie !\n\nVoulez-vous partager le pactole ou continuer le massacre ?`);

           const drawRow = new ActionRowBuilder().addComponents(
             new ButtonBuilder()
               .setCustomId('roulette_draw_yes_' + rouletteId)
               .setLabel('Partager')
               .setStyle(ButtonStyle.Success),
             new ButtonBuilder()
               .setCustomId('roulette_draw_no_' + rouletteId)
               .setLabel('Continuer le carnage')
               .setStyle(ButtonStyle.Danger)
           );

           await interaction.followUp({ embeds: [drawEmbed], components: [drawRow] });
           return;
        }

        if (shootRes.state === 'playing') {
           let nextTurnMsg = resultMsg + '\n';
           if (shootRes.reloaded) {
              nextTurnMsg += `🔄 **Le fusil était vide ! On recharge : ${shootRes.liveCount} 🔴 et ${shootRes.blankCount} ⚪.**\n\n`;
           } else {
              nextTurnMsg += `(Il reste ${shootRes.liveCount} 🔴 et ${shootRes.blankCount} ⚪ dans le chargeur)\n\n`;
           }

           nextTurnMsg += `C'est au tour de <@${shootRes.nextPlayer}> de jouer.`;

           const stateRes = await apiGet(`/roulette/state?rouletteId=${rouletteId}`);
           if (stateRes && stateRes.playerLives) {
               nextTurnMsg += '\n\n**Vies restantes :**\n';
               for (const [p, lives] of Object.entries(stateRes.playerLives)) {
                  if (stateRes.alivePlayers.includes(p)) {
                     nextTurnMsg += `- <@${p}> : ${'🩷'.repeat(lives)}\n`;
                  }
               }
           }

           const turnEmbed = new EmbedBuilder()
             .setTitle('🔫 Tour Suivant')
             .setColor('#e74c3c')
             .setDescription(nextTurnMsg);

           // Recreate target options
           // To get current players we either need to fetch state or we know it's in shootRes?
           // I didn't return alive players in shootRes for playing state except 'nextPlayer'. I need the whole list.
           // Let's fetch it from server.

           if (!stateRes || stateRes.error) {
               await interaction.followUp('Erreur de synchro.');
               return;
           }

           // We need the actual display name. We can fetch it or just use the ping format which doesn't work in select menus.
           // In select menus, <@id> is literally text. We must resolve the user object if possible.
           // Since we can't reliably async-fetch all users in the map, we can rely on interaction.guild.members.cache
           // or just use generic text with the ID if we don't have it.
           // Let's try to fetch members if possible, or fallback to "Joueur".
           const targetOptions = await Promise.all(stateRes.alivePlayers.map(async pId => {
               let displayName = 'Joueur inconnu';
               try {
                   const member = await interaction.guild.members.fetch(pId);
                   displayName = member ? (member.displayName || member.user.username) : pId;
               } catch(e) { displayName = pId; }

               const lives = stateRes.playerLives[pId] || 0;
               const livesText = '🩷'.repeat(lives);

               return {
                   label: pId === stateRes.turnPlayer ? `[TOI] ${displayName} (${livesText})` : `${displayName} (${livesText})`,
                   value: pId,
                   description: pId === stateRes.turnPlayer ? 'Me tirer dessus (Rejoue si ⚪)' : 'Tirer sur cet adversaire'
               };
           }));

           const selectMenu = new StringSelectMenuBuilder()
              .setCustomId('roulette_target_' + rouletteId)
              .setPlaceholder('Choisissez votre cible...')
              .addOptions(targetOptions.slice(0, 25));

           const actionRow = new ActionRowBuilder().addComponents(selectMenu);

           await interaction.followUp({ embeds: [turnEmbed], components: [actionRow] });
        }
        return;
    }

    let payload = { username };

    if (interaction.isStringSelectMenu()) {
      const selectedValue = interaction.values[0] === 'default' ? null : interaction.values[0];
      if (customId === 'select_font') payload.font = selectedValue;
      if (customId === 'select_anim') payload.animation = selectedValue;
      if (customId === 'select_effect') payload.effect = selectedValue;

      // Gérer les achats dans la boutique
      if (customId === 'shop_select_font' || customId === 'shop_select_anim' || customId === 'shop_select_effect') {
        let type = customId.replace('shop_select_', '');
        let price = type === 'effect' ? 50 : 20; // 50 pour effet, 20 pour le reste

        try {
          const res = await apiPost('/shop/buy', { userId, type, itemValue: selectedValue, price });
          if (res.error) {
            await interaction.reply({ content: `❌ ${res.error}`, flags: [MessageFlags.Ephemeral] });
          } else {
            await interaction.reply({ content: `✅ Achat réussi ! Vous avez débloqué un nouvel élément. Utilisez \`/style\` pour l'équiper.`, flags: [MessageFlags.Ephemeral] });
          }
        } catch (err) {
          await interaction.reply({ content: `❌ Erreur lors de l'achat.`, flags: [MessageFlags.Ephemeral] });
        }
        return;
      }
    } else if (interaction.isModalSubmit() && customId === 'modal_color') {
      let colorValue = interaction.fields.getTextInputValue('color_input').trim();
      payload.color = colorValue || null;
    } else if (interaction.isModalSubmit() && customId.startsWith('trade_modal_')) {
      const tradeId = customId.replace('trade_modal_', '');
      const itemInput = interaction.fields.getTextInputValue('trade_item_input').trim();
      const coinInput = interaction.fields.getTextInputValue('trade_coin_input').trim();

      const items = itemInput ? [itemInput] : [];
      const coins = parseInt(coinInput) || 0;

      const res = await apiPost('/trade/update', { tradeId, userId, offerItems: items, offerCoins: coins });

      if (res.error) {
         await interaction.reply({ content: `❌ Erreur : ${res.error}`, flags: [MessageFlags.Ephemeral] });
      } else {
         const trade = res.trade;

         // Fetch item names
         const itemsDbRes = await apiGet(`/items_db?userId=${userId}`).catch(() => null);
         const getItemName = (id) => {
            if (itemsDbRes) {
               for (const cat in itemsDbRes) {
                  if (itemsDbRes[cat][id]) return itemsDbRes[cat][id].name;
               }
            }
            return id;
         };

         const senderOfferItems = trade.senderOffer.items.map(getItemName).join(', ') || 'Rien';
         const receiverOfferItems = trade.receiverOffer.items.map(getItemName).join(', ') || 'Rien';

         let desc = `**Offre de <@${trade.senderId}> :**\n`;
         desc += `Objets : ${senderOfferItems}\n`;
         desc += `Pièces : ${trade.senderOffer.coins} 💰\n\n`;
         desc += `**Offre de <@${trade.receiverId}> :**\n`;
         desc += `Objets : ${receiverOfferItems}\n`;
         desc += `Pièces : ${trade.receiverOffer.coins} 💰\n`;

         const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setDescription(desc);

         const row = new ActionRowBuilder().addComponents(
             new ButtonBuilder()
              .setCustomId(`trade_propose_${tradeId}`)
              .setLabel('Modifier mon offre')
              .setStyle(ButtonStyle.Primary),
             new ButtonBuilder()
              .setCustomId(`trade_accept_${tradeId}`)
              .setLabel('Accepter')
              .setStyle(ButtonStyle.Success),
             new ButtonBuilder()
              .setCustomId(`trade_decline_${tradeId}`)
              .setLabel('Annuler')
              .setStyle(ButtonStyle.Danger)
          );

         await interaction.update({ embeds: [newEmbed], components: [row] });
      }
      return;
    } else if (interaction.isModalSubmit() && customId.startsWith('modal_meme_')) {
      const messageId = customId.replace('modal_meme_', '');
      const memeName = interaction.fields.getTextInputValue('meme_name_input').trim();
      const memeData = memeDataCache.get(messageId);

      if (!memeData) {
        await interaction.reply({ content: '❌ Données du mème expirées.', flags: [MessageFlags.Ephemeral] });
        return;
      }

      try {
        const res = await apiPost('/memes', {
          userId: interaction.user.id,
          memeName,
          memeData
        });

        if (res.error) {
          await interaction.reply({ content: `❌ Erreur : ${res.error}`, flags: [MessageFlags.Ephemeral] });
        } else {
          await interaction.reply({ content: `✅ Mème **${memeName}** enregistré avec succès dans votre collection ! Utilisez \`/meme play ${memeName}\` pour le lancer.`, flags: [MessageFlags.Ephemeral] });
        }
      } catch (err) {
        await interaction.reply({ content: `❌ Erreur serveur lors de la sauvegarde du mème.`, flags: [MessageFlags.Ephemeral] });
      }
      return;
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
        await checkUserNotifications(interaction, userId);
    } catch (err) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: `❌ Erreur : Impossible de sauvegarder le style.` });
      } else {
        await interaction.reply({ content: `❌ Erreur : Impossible de sauvegarder le style.`, flags: [MessageFlags.Ephemeral] });
      }
    }
    return;
  }

  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'meme') {
      const focusedValue = interaction.options.getFocused();
      const userId = interaction.user.id;
      try {
        const data = await apiGet(`/memes/${userId}`);
        const memes = data.memes || {};
        const memeNames = Object.keys(memes);

        const filtered = memeNames.filter(name => name.toLowerCase().includes(focusedValue.toLowerCase()));

        await interaction.respond(
          filtered.slice(0, 25).map(name => ({ name: name, value: name }))
        );
      } catch (err) {
        // En cas d'erreur d'API, on ne peut pas répondre avec l'autocomplétion
        await interaction.respond([]);
      }
    } else if (['sendurl', 'sendfile', 'message', 'ai'].includes(interaction.commandName)) {
      const focusedOption = interaction.options.getFocused(true);
      if (focusedOption.name === 'tts') {
        try {
          const data = await apiGet('/tts/models');
          const models = data.models || [];
          const filtered = models.filter(name => name.toLowerCase().includes(focusedOption.value.toLowerCase()));

          await interaction.respond(
            filtered.slice(0, 25).map(name => ({ name: name, value: name }))
          );
        } catch (err) {
          await interaction.respond([]);
        }
      }
    } else if (interaction.commandName === 'inventory' || interaction.commandName === 'market' || interaction.commandName === 'fish' || interaction.commandName === 'arena' || interaction.commandName === 'roulette') {
      const focusedOption = interaction.options.getFocused(true);
      if (focusedOption.name === 'objet' || focusedOption.name === 'poisson') {
         try {
            const userId = interaction.user.id;
            const res = await apiGet(`/inventory/${userId}`);

            // To display friendly names we could query /items_db but caching or parsing client side is lighter.
            // Since it's just an id filter, we'll keep it fast.
            let itemsDbRes = null;
            try { itemsDbRes = await apiGet(`/items_db?userId=${userId}`); } catch(e){}

            if (res && res.items) {
               let itemIds = Object.keys(res.items);

               // Restreindre uniquement aux poissons si la commande est /fish
               if (interaction.commandName === 'fish' && focusedOption.name === 'poisson') {
                  itemIds = itemIds.filter(id => id.startsWith('F_'));
               }

               const filtered = itemIds.filter(id => id.toLowerCase().includes(focusedOption.value.toLowerCase()));

               const options = filtered.slice(0, 24).map(id => {
                   let displayName = id;
                   if (itemsDbRes) {
                     // Recherche du vrai nom dans la base
                     for (const cat in itemsDbRes) {
                        if (itemsDbRes[cat][id]) {
                           displayName = itemsDbRes[cat][id].name;
                           break;
                        }
                     }
                   }
                   return { name: `${displayName} (x${res.items[id]})`, value: id };
                 });

               if (interaction.commandName === 'fish' && focusedOption.name === 'poisson') {
                   options.unshift({ name: '🐟 Tout vendre (Tous les poissons)', value: 'all' });
               }

               await interaction.respond(options);
            } else {
               if (interaction.commandName === 'fish' && focusedOption.name === 'poisson') {
                   await interaction.respond([{ name: '🐟 Tout vendre (Tous les poissons)', value: 'all' }]);
               } else {
                   await interaction.respond([]);
               }
            }
         } catch(e) {
            console.error('Autocomplete Error:', e);
            await interaction.respond([]);
         }
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // Réponse différée pour les commandes longues
  if (commandName === 'sendurl' || commandName === 'sendfile' || commandName === 'message' || commandName === 'ai' || commandName === 'online' || commandName === 'profile' || commandName === 'leaderboard' || commandName === 'queue' || commandName === 'download' || commandName === 'meme' || commandName === 'event') {
    await interaction.deferReply();
  } else if (commandName === 'tuto' || commandName === 'info' || commandName === 'style' || commandName === 'dashboard') {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  } else if (commandName === 'trade' || commandName === 'market' || commandName === 'lootbox' || commandName === 'inventory' || commandName === 'collection' || commandName === 'daily' || commandName === 'fish' || commandName === 'slots' || commandName === 'coinflip' || commandName === 'achievements' || commandName === 'craft' || commandName === 'arena' || commandName === 'roulette') {
        await interaction.deferReply({ ephemeral: false });
  } else {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
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
        const modele3d = interaction.options.getBoolean('modele3d') !== false; // True by default
        const filter = interaction.options.getString('filtre') || '';
        let duration = interaction.options.getInteger('duree');
        if (duration && duration > 15) duration = 15;
        if (duration) duration *= 1000;

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

        const data = await apiPost('/sendurl', { url, target, caption, senderName, avatarUrl, ttsVoice, greenscreen, filter, userId, color, font, animation, effect, duration });

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

        const memeDataToCache = {
            url: data.url || url, // If yt-dlp, data.url is set, otherwise direct url
            type: data.directUrl ? 'image' : 'video', // Approximation, the server knows better but we simplify here. Could refine if needed.
            caption: caption,
            style: { color, font, animation, effect },
            greenscreen,
            filter
        };

        await sendReputationLog(interaction, 'Nouveau Lien Envoyé', `**Cible :** ${target === 'all' ? 'Tout le monde' : target}\n**Lien :** ${url}\n**Texte :** ${caption || '*Aucun*'}`, null, memeDataToCache);
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
        const modele3d = interaction.options.getBoolean('modele3d') !== false; // True by default
        const filter = interaction.options.getString('filtre') || '';
        let duration = interaction.options.getInteger('duree');
        if (duration && duration > 15) duration = 15;
        if (duration) duration *= 1000;

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

        const data = await apiPost('/sendfile', { fileUrl, fileType, target, caption, senderName, avatarUrl, ttsVoice, greenscreen, filter, userId, color, font, animation, effect, duration });

        if (data.error) {
          await interaction.editReply(`❌ Erreur : ${data.error}`);
          return;
        }

        await interaction.editReply(
          `✅ Fichier (${fileType}) envoyé à **${target === 'all' ? 'tout le monde' : target}** !` +
          (caption ? `\n💬 Caption : "${caption}"` : '')
        );

        const memeDataToCache = {
            url: attachment.url,
            type: fileType,
            caption: caption,
            style: { color, font, animation, effect },
            greenscreen,
            filter
        };

        await sendReputationLog(interaction, 'Nouveau Fichier Envoyé', `**Cible :** ${target === 'all' ? 'Tout le monde' : target}\n**Type :** ${fileType}\n**Texte :** ${caption || '*Aucun*'}`, attachment.url, memeDataToCache);
        break;
      }

      // ── /profile ───────────────────────────────────────
      case 'profile': {
        const userOpt = interaction.options.getUser('utilisateur');
        const targetUser = userOpt || interaction.user;
        const targetUserId = targetUser.id;
        const targetUserName = targetUser.displayName || targetUser.username;

        const data = await apiGet(`/stats/${targetUserId}`);

        if (data.error || !data.totalCount) {
          await interaction.editReply(`❌ **${targetUserName}** n'a pas encore de profil actif sur BordelBox (aucun envoi).`);
          return;
        }

        const totalMedia = (data.mediaCount || 0) + (data.fileCount || 0);
        const bordelCoins = data.bordelCoins !== undefined ? data.bordelCoins : (data.reputation || 0);
        const fishesCaught = data.fishesCaught || 0;
        const slotsPlayed = data.slotsPlayed || 0;
        const profileData = data.profile || {};

        const rankMediaStr = data.rankMedia ? ` *(#${data.rankMedia})*` : '';
        const rankCoinsStr = data.rankCoins ? ` *(#${data.rankCoins})*` : '';

        const embedColor = profileData.color && profileData.color.startsWith('#')
          ? profileData.color.toUpperCase()
          : '#3498db';

        const embed = new EmbedBuilder()
          .setTitle(`👤 Profil de ${data.username || targetUserName}`)
          .setThumbnail(targetUser.displayAvatarURL({ size: 256, extension: 'png' }))
          .setColor(embedColor)
          .addFields(
            { name: '📊 Statistiques d\'envoi', value: `**Médias :** ${totalMedia}${rankMediaStr}\n**Messages Texte :** ${data.messageCount || 0}\n**Total :** ${data.totalCount}`, inline: true },
            { name: '💰 BordelCoins', value: `**Solde :** ${bordelCoins}${rankCoinsStr}`, inline: true },
            { name: '🎮 Mini-jeux', value: `🎣 **Poissons :** ${fishesCaught}\n🎰 **Machines à sous :** ${slotsPlayed}`, inline: false }
          );

        // Dates clés
        let datesText = '';
        if (data.firstAction) datesText += `**Premier envoi :** <t:${Math.floor(data.firstAction / 1000)}:F>\n`;
        if (data.lastAction) datesText += `**Dernière activité :** <t:${Math.floor(data.lastAction / 1000)}:R>`;

        if (datesText) {
          embed.addFields({ name: '📅 Historique', value: datesText, inline: false });
        }

        // Style visuel
        const allFonts = {
          '"Press Start 2P"': 'Pixel (Retro)',
          'Creepster': 'Horreur',
          'Impact': 'Impact (Meme)',
          '"Comic Sans MS"': 'Comic Sans MS (Troll)',
          '"Courier New"': 'Courier New (Machine à écrire)',
          'Arial': 'Arial (Classique)',
          'Georgia': 'Georgia (Sérieux)',
          'Bangers': 'Bangers (Comics)',
          'Oswald': 'Oswald (Gras)',
          'Cinzel': 'Cinzel (Épique)'
        };

        const allAnims = {
          'fade': 'Fondu (Fade)',
          'glitch': 'Glitch',
          'typewriter': 'Machine à écrire',
          'pulse': 'Pulse',
          'slide': 'Glissement (Slide)',
          'bounce': 'Rebond (Bounce)',
          'zoom': 'Zoom',
          'spin': 'Rotation (Spin)',
          'shake': 'Tremblement (Shake)',
          'drop': 'Chute (Drop)',
          'swing': 'Swing',
          'wobble': 'Wobble',
          'flip': 'Flip'
        };

        const allEffects = {
          'neige': 'Neige',
          'coeurs': 'Cœurs',
          'matrix': 'Matrix',
          'particules': 'Particules',
          'etoiles': 'Étoiles',
          'confetti': 'Confettis',
          'feu': 'Feu',
          'pluie': 'Pluie',
          'bulles': 'Bulles',
          'eclairs': 'Éclairs'
        };

        // Ajouter les badges et le titre de l'inventaire si équipé
        const inventoryData = await apiGet(`/inventory/${targetUserId}`);

        let itemsDb = null;
        try {
            const dbRes = await apiGet(`/items_db?userId=${targetUserId}`);
            if (!dbRes.error) itemsDb = dbRes;
        } catch(e) {}

        const styleParts = [];

        if (profileData.color) {
          let colorName = profileData.color;
          if (itemsDb && itemsDb.colors) {
            // Find the color name from the DB using the raw value
            const colorObj = Object.values(itemsDb.colors).find(c => c.value === profileData.color);
            if (colorObj) colorName = colorObj.name;
          }
          styleParts.push(`**Couleur :** ${colorName}`);
        }

        if (profileData.font) {
          const fontName = allFonts[profileData.font] || profileData.font;
          styleParts.push(`**Police :** ${fontName}`);
        }

        if (profileData.animation) {
          const animName = allAnims[profileData.animation] || profileData.animation;
          styleParts.push(`**Animation :** ${animName}`);
        }

        if (profileData.effect) {
          const effectName = allEffects[profileData.effect] || profileData.effect;
          styleParts.push(`**Effet :** ${effectName}`);
        }

        if (styleParts.length > 0) {
          embed.addFields({ name: '🎨 Style Visuel Actuel', value: styleParts.join('\n'), inline: false });
        } else {
          embed.addFields({ name: '🎨 Style Visuel Actuel', value: '*Aucun style personnalisé défini.*', inline: false });
        }

        if (inventoryData && inventoryData.equipped) {
           const equippedTitle = inventoryData.equipped.title;
           const equippedBadge = inventoryData.equipped.badge;

           let titleDisplay = equippedTitle || 'Aucun';
           let badgeDisplay = equippedBadge || 'Aucun';

           if (itemsDb) {
              for (const cat in itemsDb) {
                 if (equippedTitle && itemsDb[cat][equippedTitle]) {
                    titleDisplay = itemsDb[cat][equippedTitle].name;
                 }
                 if (equippedBadge && itemsDb[cat][equippedBadge]) {
                    const badgeInfo = itemsDb[cat][equippedBadge];
                    badgeDisplay = badgeInfo.name;
                    if (badgeInfo.emoji) badgeDisplay = `${badgeInfo.emoji} ${badgeDisplay}`;
                 }
              }
           }

           if (equippedTitle || equippedBadge) {
              embed.addFields({ name: '🎒 Équipement Spécial', value: `**Titre:** ${titleDisplay}\n**Badge:** ${badgeDisplay}`, inline: false });
           }
        }

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      // ── /lootbox ───────────────────────────────────────
      case 'lootbox': {
        const subCmd = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        if (subCmd === 'buy') {
          const quantite = interaction.options.getInteger('quantite') || 1;
          const res = await apiPost('/lootbox/buy', { userId, amount: quantite });
          if (res.error) {
            await interaction.editReply(`❌ Erreur : ${res.error}`);
          } else {
            await interaction.editReply(`✅ Tu as acheté **${quantite} Lootbox(es)** pour **${quantite * 10} BordelCoins** ! Utilise \`/lootbox open\` pour les ouvrir.`);
          }
        } else if (subCmd === 'open') {
          const res = await apiPost('/lootbox/open', { userId });
          if (res.error) {
            await interaction.editReply(`❌ Erreur : ${res.error}`);
            return;
          }

          const item = res.item;
          let msg = `🔄 Ouverture de la Lootbox...\n🎰 ⬛ ⬛ ⬛`;
          await interaction.editReply(msg);

          // Petite animation
          await new Promise(r => setTimeout(r, 800));
          await interaction.editReply(`🔄 Ouverture de la Lootbox...\n🎰 🟩 ⬛ ⬛`);
          await new Promise(r => setTimeout(r, 800));
          await interaction.editReply(`🔄 Ouverture de la Lootbox...\n🎰 🟩 🟨 ⬛`);
          await new Promise(r => setTimeout(r, 800));
          await interaction.editReply(`🔄 Ouverture de la Lootbox...\n🎰 🟩 🟨 🔴`);
          await new Promise(r => setTimeout(r, 1000));

          let rarityEmoji = '⚪';
          let colorHex = '#FFFFFF';
          if (item.rarity === 'commun') { rarityEmoji = '🟢'; colorHex = '#2ecc71'; }
          else if (item.rarity === 'rare') { rarityEmoji = '🔵'; colorHex = '#3498db'; }
          else if (item.rarity === 'epique') { rarityEmoji = '🟣'; colorHex = '#9b59b6'; }
          else if (item.rarity === 'legendaire') { rarityEmoji = '🟡'; colorHex = '#f1c40f'; }
          else if (item.rarity === 'mythique') { rarityEmoji = '🔴✨'; colorHex = '#e74c3c'; }

          const embed = new EmbedBuilder()
            .setColor(colorHex)
            .setTitle(`🎉 Tu as obtenu : ${item.name} !`)
            .setDescription(`**Rareté :** ${rarityEmoji} ${item.rarity.toUpperCase()}\n**Catégorie :** ${item.category}`);

          if (item.category === 'jackpots') {
            embed.setDescription(embed.data.description + `\n💰 **+${item.reward} BordelCoins !**`);
          } else {
            embed.setFooter({ text: 'Utilise /inventory equip pour l\'équiper !' });
          }

          await interaction.editReply({ content: '🎁 **LOOTBOX OUVERTE !**', embeds: [embed] });
        }
        break;
      }

      // ── /inventory ─────────────────────────────────────
      case 'inventory': {
        const subCmd = interaction.options.getSubcommand();

        if (subCmd === 'view') {
           const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
           const targetId = targetUser.id;

           const res = await apiGet(`/inventory/${targetId}`);
           if (res.error) {
              await interaction.editReply(`❌ Erreur : ${res.error}`);
              return;
           }

           const embed = new EmbedBuilder()
             .setColor(0x0099FF)
             .setTitle(`🎒 Inventaire de ${targetUser.displayName || targetUser.username}`)
             .setDescription(`<@${targetId}>\n\n**Lootboxes possédées :** 🎁 ${res.lootboxes}`);

           let itemsText = '';

           // Fetch itemsDb to get real names and procedurals
           let itemsDb = null;
           try {
               const dbRes = await apiGet(`/items_db?userId=${targetId}`);
               if (!dbRes.error) itemsDb = dbRes;
           } catch(e) {}

           for (const [itemId, count] of Object.entries(res.items)) {
              let itemName = itemId;
              let itemExtra = '';
              if (itemsDb) {
                 // Chercher l'objet dans la DB
                 for (const cat in itemsDb) {
                    if (itemsDb[cat][itemId]) {
                       const itemInfo = itemsDb[cat][itemId];
                       itemName = itemInfo.name;
                       if (itemInfo.emoji) itemName = `${itemInfo.emoji} ${itemName}`;
                       if (itemInfo.rarity) {
                          // Capitaliser la première lettre de la rareté
                          const rarityStr = itemInfo.rarity.charAt(0).toUpperCase() + itemInfo.rarity.slice(1);
                          itemName = `${itemName} (${rarityStr})`;
                       }
                       if (itemInfo.rarity === 'transcendant' && itemInfo.originalOwnerName && itemInfo.obtainedAt) {
                           itemExtra = `\n  └ *Découvert par ${itemInfo.originalOwnerName} le <t:${Math.floor(itemInfo.obtainedAt / 1000)}:d>*`;
                       }
                       break;
                    }
                 }
              }
              itemsText += `• **${itemName}** (x${count})${itemExtra}\n`;
           }
           if (!itemsText) itemsText = '*Inventaire vide. Achète des lootboxes ou gagne-les !*';

           embed.addFields(
             { name: '📦 Objets', value: itemsText.substring(0, 1024) },
             { name: '👕 Équipement Actuel', value: `**Titre:** ${res.equipped.title || 'Aucun'}\n**Badge:** ${res.equipped.badge || 'Aucun'}\n**Couleur:** ${res.equipped.color || 'Par défaut'}` }
           );

           await interaction.editReply({ embeds: [embed] });
        } else if (subCmd === 'equip') {
           const userId = interaction.user.id;
           const itemToEquip = interaction.options.getString('objet', true);
           const res = await apiPost('/inventory/equip', { userId, itemId: itemToEquip });

           if (res.error) {
              await interaction.editReply(`❌ Erreur : ${res.error}`);
           } else {
              await interaction.editReply(`✅ Objet **${itemToEquip}** équipé avec succès dans la catégorie **${res.type}** !`);
           }
        }
        break;
      }

      // ── /market ────────────────────────────────────────
      case 'market': {
        const subCmd = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        if (subCmd === 'list') {
           const res = await apiGet('/market');
           if (!res.listings || res.listings.length === 0) {
              await interaction.editReply('📭 Le marché est actuellement vide.');
              return;
           }

           const embed = new EmbedBuilder()
             .setColor(0xF1C40F)
             .setTitle('🛒 Marketplace BordelBox');

           let desc = '';
           for (const l of res.listings.slice(0, 20)) {
              let itemName = l.itemInfo ? l.itemInfo.name : l.itemId;
              if (l.itemInfo && l.itemInfo.rarity) {
                 const rarityStr = l.itemInfo.rarity.charAt(0).toUpperCase() + l.itemInfo.rarity.slice(1);
                 itemName += ` (${rarityStr})`;
              }
              desc += `\`${l.id}\` | **${itemName}** vendu par *${l.sellerName}* pour 💰 **${l.price}**\n`;
           }
           embed.setDescription(desc || '*Aucune offre.*');
           embed.setFooter({ text: 'Utilisez /market buy <id> pour acheter' });

           await interaction.editReply({ embeds: [embed] });
        } else if (subCmd === 'sell') {
           const itemId = interaction.options.getString('objet', true);
           const price = interaction.options.getInteger('prix', true);
           const username = interaction.user.displayName || interaction.user.username;

           const res = await apiPost('/market/sell', { sellerId: userId, sellerName: username, itemId, price });
           if (res.error) {
             await interaction.editReply(`❌ Erreur : ${res.error}`);
           } else {
             const itemName = res.itemName || itemId;
             await interaction.editReply(`✅ Objet **${itemName}** mis en vente pour **${price} BordelCoins** ! (ID: \`${res.listingId}\`)`);
           }
        } else if (subCmd === 'buy') {
           const listingId = interaction.options.getString('id', true);
           const res = await apiPost('/market/buy', { buyerId: userId, listingId });

           if (res.error) {
             await interaction.editReply(`❌ Erreur : ${res.error}`);
           } else {
             const itemName = res.itemName || res.item;
             await interaction.editReply(`✅ Achat réussi ! Vous avez reçu l'objet **${itemName}**.`);
           }
        } else if (subCmd === 'cancel') {
           const listingId = interaction.options.getString('id', true);
           const res = await apiPost('/market/cancel', { sellerId: userId, listingId });

           if (res.error) {
             await interaction.editReply(`❌ Erreur : ${res.error}`);
           } else {
             await interaction.editReply(`✅ Offre annulée. L'objet a été remis dans votre inventaire.`);
           }
        }
        break;
      }

      // ── /trade ─────────────────────────────────────────
      case 'trade': {
        const targetUser = interaction.options.getUser('joueur', true);
        const targetId = targetUser.id;
        const senderId = interaction.user.id;

        if (targetId === senderId) {
            await interaction.editReply("❌ Tu ne peux pas échanger avec toi-même.");
            break;
        }

        const res = await apiPost('/trade/request', {
           senderId,
           senderName: interaction.user.displayName || interaction.user.username,
           receiverId: targetId,
           receiverName: targetUser.displayName || targetUser.username
        });

        if (res.error) {
           await interaction.editReply(`❌ Erreur : ${res.error}`);
           return;
        }

        const embed = new EmbedBuilder()
          .setColor(0x3498DB)
          .setTitle('🤝 Proposition d\'échange')
          .setDescription(`<@${targetId}>, <@${senderId}> te propose un échange ! Cliquez sur "Proposer" pour ajouter vos objets et/ou vos pièces à l'échange.`);

        const row = new ActionRowBuilder().addComponents(
           new ButtonBuilder()
            .setCustomId(`trade_propose_${res.tradeId}`)
            .setLabel('Proposer des objets/pièces')
            .setStyle(ButtonStyle.Primary),
           new ButtonBuilder()
            .setCustomId(`trade_decline_${res.tradeId}`)
            .setLabel('Annuler')
            .setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({ content: `<@${targetId}> <@${senderId}>`, embeds: [embed], components: [row] });
        break;
      }

      // ── /leaderboard ───────────────────────────────────
      case 'leaderboard': {
        const type = interaction.options.getString('type') || 'media';
        const period = interaction.options.getString('periode') || 'global';
        const lb = await apiGet(`/leaderboard?type=${type}&period=${period}`);

        if (!lb || lb.length === 0) {
          await interaction.editReply(`🏆 Le leaderboard ${period === 'daily' ? 'journalier' : 'global'} est vide pour cette catégorie.`);
          return;
        }

        const places = ['🥇', '🥈', '🥉'];
        const list = lb.map((user, i) => {
          const rank = i < 3 ? places[i] : `**#${i + 1}**`;
          let valueStr = '';
          if (type === 'coins') {
            const coins = user.score !== undefined ? user.score : (user.bordelCoins !== undefined ? user.bordelCoins : (user.reputation || 0));
            valueStr = `${coins} pièces`;
          } else if (type === 'fishes') {
            const fishes = user.score !== undefined ? user.score : (user.fishesCaught || 0);
            valueStr = `${fishes} poissons`;
          } else if (type === 'slots') {
            const slots = user.score !== undefined ? user.score : (user.slotsPlayed || 0);
            valueStr = `${slots} parties`;
          } else {
            const totalMedia = user.score !== undefined ? user.score : ((user.mediaCount || 0) + (user.fileCount || 0));
            valueStr = `${totalMedia} médias`;
          }
          return `${rank} **${user.username}** — ${valueStr}`;
        }).join('\n');

        let title = '🏆 **TOP MÉDIAS BORDELBOX** 🏆';
        if (type === 'coins') title = '🏆 **TOP BORDELCOINS** 🏆';
        if (type === 'fishes') title = '🎣 **TOP POISSONS PÊCHÉS** 🏆';
        if (type === 'slots') title = '🎰 **TOP MACHINES À SOUS** 🏆';

        if (period === 'daily') {
          title = title.replace('🏆', '📅'); // Replace first trophy to indicate daily
          title += ' *(Journalier)*';
        }

        await interaction.editReply(`${title}\n\n${list}`);
        break;
      }

      // ── /style ─────────────────────────────────────────
      case 'style': {
        const userId = interaction.user.id;
        const data = await apiGet(`/style/${userId}`);
        const p = data.profile || {};
        const unlocked = data.unlocked || { font: [], animation: [], effect: [] };

        let msg = `🎨 **Configuration de votre profil visuel**\n\n`;
        msg += `> **Couleur** : \`${p.color || 'Par défaut'}\`\n`;
        msg += `> **Police** : \`${p.font || 'Par défaut'}\`\n`;
        msg += `> **Animation** : \`${p.animation || 'Par défaut'}\`\n`;
        msg += `> **Effet** : \`${p.effect || 'Aucun'}\`\n\n`;
        msg += `Utilisez les menus ci-dessous pour modifier votre style. *(Utilisez \`/shop\` pour débloquer de nouveaux éléments)*`;

        // Construire les options en fonction de ce qui est débloqué
        const allFonts = [
          { label: 'Par défaut', value: 'default', free: true },
          { label: 'Pixel (Retro)', value: '"Press Start 2P"' },
          { label: 'Horreur', value: 'Creepster' },
          { label: 'Impact (Meme)', value: 'Impact' },
          { label: 'Comic Sans MS (Troll)', value: '"Comic Sans MS"' },
          { label: 'Courier New (Machine à écrire)', value: '"Courier New"' },
          { label: 'Arial (Classique)', value: 'Arial' },
          { label: 'Georgia (Sérieux)', value: 'Georgia' },
          { label: 'Bangers (Comics)', value: 'Bangers' },
          { label: 'Oswald (Gras)', value: 'Oswald' },
          { label: 'Cinzel (Épique)', value: 'Cinzel' }
        ];

        const allAnims = [
          { label: 'Par défaut', value: 'default', free: true },
          { label: 'Fondu (Fade)', value: 'fade', free: true },
          { label: 'Glitch', value: 'glitch' },
          { label: 'Machine à écrire', value: 'typewriter' },
          { label: 'Pulse', value: 'pulse' },
          { label: 'Glissement (Slide)', value: 'slide' },
          { label: 'Rebond (Bounce)', value: 'bounce' },
          { label: 'Zoom', value: 'zoom' },
          { label: 'Rotation (Spin)', value: 'spin' },
          { label: 'Tremblement (Shake)', value: 'shake' },
          { label: 'Chute (Drop)', value: 'drop' },
          { label: 'Swing', value: 'swing' },
          { label: 'Wobble', value: 'wobble' },
          { label: 'Flip', value: 'flip' }
        ];

        const allEffects = [
          { label: 'Aucun', value: 'aucun', free: true },
          { label: 'Neige', value: 'neige' },
          { label: 'Cœurs', value: 'coeurs' },
          { label: 'Matrix', value: 'matrix' },
          { label: 'Particules', value: 'particules' },
          { label: 'Étoiles', value: 'etoiles' },
          { label: 'Confettis', value: 'confetti' },
          { label: 'Feu', value: 'feu' },
          { label: 'Pluie', value: 'pluie' },
          { label: 'Bulles', value: 'bulles' },
          { label: 'Éclairs', value: 'eclairs' }
        ];

        const availableFonts = allFonts.filter(f => f.free || unlocked.font.includes(f.value));
        const availableAnims = allAnims.filter(a => a.free || unlocked.animation.includes(a.value));
        const availableEffects = allEffects.filter(e => e.free || unlocked.effect.includes(e.value));

        const components = [];

        if (availableFonts.length > 0) {
          components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('select_font')
              .setPlaceholder('Choisir une police...')
              .addOptions(availableFonts)
          ));
        }

        if (availableAnims.length > 0) {
          components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('select_anim')
              .setPlaceholder('Choisir une animation...')
              .addOptions(availableAnims)
          ));
        }

        if (availableEffects.length > 0) {
          components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('select_effect')
              .setPlaceholder('Choisir un effet visuel...')
              .addOptions(availableEffects)
          ));
        }

        const colorBtnRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('btn_color')
            .setLabel('Modifier la Couleur (Gratuit)')
            .setStyle(ButtonStyle.Primary)
        );
        components.push(colorBtnRow);

        await interaction.editReply({
          content: msg,
          components: components
        });
        break;
      }

      // ── /shop ──────────────────────────────────────────
      case 'shop': {
        const userId = interaction.user.id;
        const data = await apiGet(`/style/${userId}`);
        const unlocked = data.unlocked || { font: [], animation: [], effect: [] };

        const statsData = await apiGet(`/stats/${userId}`);
        const coins = (statsData && statsData.bordelCoins !== undefined) ? statsData.bordelCoins : (statsData && statsData.reputation) || 0;

        let msg = `🛒 **Boutique BordelBox**\n\n`;
        msg += `> **Votre solde :** 💰 \`${coins} BordelCoins\`\n\n`;
        msg += `Sélectionnez un élément ci-dessous pour l'acheter. (20 💰 pour Polices/Animations, 50 💰 pour Effets)`;

        const allFonts = [
          { label: 'Pixel (Retro)', value: '"Press Start 2P"' },
          { label: 'Horreur', value: 'Creepster' },
          { label: 'Impact (Meme)', value: 'Impact' },
          { label: 'Comic Sans MS (Troll)', value: '"Comic Sans MS"' },
          { label: 'Courier New (Machine)', value: '"Courier New"' },
          { label: 'Arial', value: 'Arial' },
          { label: 'Georgia', value: 'Georgia' },
          { label: 'Bangers (Comics)', value: 'Bangers' },
          { label: 'Oswald (Gras)', value: 'Oswald' },
          { label: 'Cinzel (Épique)', value: 'Cinzel' }
        ];

        const allAnims = [
          { label: 'Glitch', value: 'glitch' },
          { label: 'Machine à écrire', value: 'typewriter' },
          { label: 'Pulse', value: 'pulse' },
          { label: 'Glissement (Slide)', value: 'slide' },
          { label: 'Rebond (Bounce)', value: 'bounce' },
          { label: 'Zoom', value: 'zoom' },
          { label: 'Rotation (Spin)', value: 'spin' },
          { label: 'Tremblement (Shake)', value: 'shake' },
          { label: 'Chute (Drop)', value: 'drop' },
          { label: 'Swing', value: 'swing' },
          { label: 'Wobble', value: 'wobble' },
          { label: 'Flip', value: 'flip' }
        ];

        const allEffects = [
          { label: 'Neige', value: 'neige' },
          { label: 'Cœurs', value: 'coeurs' },
          { label: 'Matrix', value: 'matrix' },
          { label: 'Particules', value: 'particules' },
          { label: 'Étoiles', value: 'etoiles' },
          { label: 'Confettis', value: 'confetti' },
          { label: 'Feu', value: 'feu' },
          { label: 'Pluie', value: 'pluie' },
          { label: 'Bulles', value: 'bulles' },
          { label: 'Éclairs', value: 'eclairs' }
        ];

        const buyableFonts = allFonts.filter(f => !unlocked.font.includes(f.value));
        const buyableAnims = allAnims.filter(a => !unlocked.animation.includes(a.value));
        const buyableEffects = allEffects.filter(e => !unlocked.effect.includes(e.value));

        const components = [];

        if (buyableFonts.length > 0) {
          components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('shop_select_font')
              .setPlaceholder('Acheter une police (20 💰)...')
              .addOptions(buyableFonts)
          ));
        }

        if (buyableAnims.length > 0) {
          components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('shop_select_anim')
              .setPlaceholder('Acheter une animation (20 💰)...')
              .addOptions(buyableAnims)
          ));
        }

        if (buyableEffects.length > 0) {
          components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('shop_select_effect')
              .setPlaceholder('Acheter un effet (50 💰)...')
              .addOptions(buyableEffects)
          ));
        }

        if (components.length === 0) {
          msg += `\n\n🎉 **Vous avez tout débloqué !** Il n'y a plus rien à acheter.`;
        }

        await interaction.editReply({ content: msg, components: components });
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

          // Planifier la fin du sondage et l'affichage des résultats
          setTimeout(async () => {
            try {
              const resultRes = await apiGet(`/event/${res.event.id}`);
              if (resultRes.error || !resultRes.event) return;

              const eventData = resultRes.event;
              const totalVotes = eventData.totalVotes || 0;
              const resultsEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle(`📊 Résultats finaux : ${eventData.question}`)
                .setDescription(`Total des votes : **${totalVotes}**`);

              let resultsText = '';
              eventData.choices.forEach((choice, index) => {
                const votes = eventData.votes[index] || 0;
                const percentage = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
                resultsText += `**${choice}** : ${votes} vote(s) (${percentage}%)\n`;
              });

              resultsEmbed.addFields({ name: 'Résultats', value: resultsText });

              await interaction.followUp({ embeds: [resultsEmbed] });
            } catch (err) {
              console.error('[Sondage] Erreur de récupération des résultats:', err);
            }
          }, 30000);
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

      // ── /event ─────────────────────────────────────────
      case 'event': {
        const subCmd = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        if (subCmd === 'boss') {
          const name = interaction.options.getString('nom', true);
          const imageOpt = interaction.options.getAttachment('image');
          const image = imageOpt ? imageOpt.url : null;
          const greenscreen = interaction.options.getBoolean('greenscreen') || false;
          const filter = interaction.options.getString('filter') || 'aucun';
          const effect = interaction.options.getString('effet') || 'aucun';

          const res = await apiPost('/event/start', { type: 'boss', name, image, duration: 30000, greenscreen, filter, effect });

          if (res.error) {
            await interaction.editReply(`❌ Erreur : ${res.error}`);
            return;
          }

          const bossHp = res.event.hp; // HP renvoyés par l'API (dynamique)

          const embed = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle(`⚔️ Un Boss est apparu !`)
            .setDescription(`**${name}** a **${bossHp} HP**.\n\nSpammez le bouton pour l'attaquer ! (30 secondes)\n\n*(Nécessite d'avoir l'overlay ouvert pour obtenir des BordelCoins !)*`);

          if (image) embed.setThumbnail(image);

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`event_boss_hit_${res.event.id}`)
              .setLabel('🗡️ Attaquer !')
              .setStyle(ButtonStyle.Danger)
          );

          await interaction.editReply({ embeds: [embed], components: [row] });
        }
        else if (subCmd === 'sondage') {
          const question = interaction.options.getString('question', true);
          const c1 = interaction.options.getString('choix1', true);
          const c2 = interaction.options.getString('choix2', true);
          const c3 = interaction.options.getString('choix3');
          const c4 = interaction.options.getString('choix4');

          const choices = [c1, c2];
          if (c3) choices.push(c3);
          if (c4) choices.push(c4);

          const res = await apiPost('/event/start', { type: 'sondage', question, choices, duration: 30000 });

          if (res.error) {
            await interaction.editReply(`❌ Erreur : ${res.error}`);
            return;
          }

          const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`📊 Sondage en direct !`)
            .setDescription(`**${question}**\n\nVotez avec les boutons ci-dessous ! (30 secondes)`);

          const row = new ActionRowBuilder();
          choices.forEach((c, index) => {
            row.addComponents(
              new ButtonBuilder()
                .setCustomId(`event_sondage_vote_${res.event.id}_${index}`)
                .setLabel(c.substring(0, 80))
                .setStyle(ButtonStyle.Primary)
            );
          });

          await interaction.editReply({ embeds: [embed], components: [row] });

          // Planifier la fin du sondage et l'affichage des résultats
          setTimeout(async () => {
            try {
              const resultRes = await apiGet(`/event/${res.event.id}`);
              if (resultRes.error || !resultRes.event) return;

              const eventData = resultRes.event;
              const totalVotes = eventData.totalVotes || 0;
              const resultsEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle(`📊 Résultats finaux : ${eventData.question}`)
                .setDescription(`Total des votes : **${totalVotes}**`);

              let resultsText = '';
              eventData.choices.forEach((choice, index) => {
                const votes = eventData.votes[index] || 0;
                const percentage = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
                resultsText += `**${choice}** : ${votes} vote(s) (${percentage}%)\n`;
              });

              resultsEmbed.addFields({ name: 'Résultats', value: resultsText });

              await interaction.followUp({ embeds: [resultsEmbed] });
            } catch (err) {
              console.error('[Sondage] Erreur de récupération des résultats:', err);
            }
          }, 30000);
        }
        break;
      }

      // ── /ai ────────────────────────────────────────────
      case 'ai': {
        const prompt   = interaction.options.getString('prompt', true);
        const targetUser = interaction.options.getUser('cible');
        const target  = targetUser ? targetUser.username : 'all';
        const ttsVoice = interaction.options.getString('tts') || '';
        const greenscreen = interaction.options.getBoolean('greenscreen') || false;
        const modele3d = interaction.options.getBoolean('modele3d') !== false; // True by default
        let duration = interaction.options.getInteger('duree');
        if (duration && duration > 15) duration = 15;
        if (duration) duration *= 1000;

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

        await interaction.editReply(`🤖 Génération de la réponse IA pour "${prompt}"...`);

        const data = await apiPost('/ai', { prompt, target, senderName, avatarUrl, ttsVoice, greenscreen, modele3d, userId, color, font, animation, effect, duration });

        if (data.error) {
          await interaction.editReply(`❌ Erreur IA : ${data.error}`);
          return;
        }

        await interaction.editReply(
          `🤖 Message IA généré pour "${prompt}" envoyé à **${target === 'all' ? 'tout le monde' : target}** :\n> ${data.text}`
        );
        await sendReputationLog(interaction, 'Nouveau Message IA Envoyé', `**Cible :** ${target === 'all' ? 'Tout le monde' : target}\n**Prompt :** ${prompt}\n**Réponse :** ${data.text}`);
        break;
      }

      // ── /message ───────────────────────────────────────
      case 'message': {
        const text   = interaction.options.getString('texte', true);
        const targetUser = interaction.options.getUser('cible');
        const target  = targetUser ? targetUser.username : 'all';
        const ttsVoice = interaction.options.getString('tts') || '';
        const greenscreen = interaction.options.getBoolean('greenscreen') || false;
        const modele3d = interaction.options.getBoolean('modele3d') !== false; // True by default
        let duration = interaction.options.getInteger('duree');
        if (duration && duration > 15) duration = 15;
        if (duration) duration *= 1000;

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

        const data = await apiPost('/message', { text, target, senderName, avatarUrl, ttsVoice, greenscreen, userId, color, font, animation, effect, duration });

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

      // ── /dashboard ────────────────────────────────────────
      case 'dashboard': {
        const msg = `🌐 **Tableau de Bord Web**\n\n` +
                    `Vous pouvez uploader des fichiers (jusqu'à 250 Mo), gérer vos objets et jouer des sons directement depuis votre navigateur :\n` +
                    `<${SERVER_URL}/dashboard>\n\n` +
                    `*Une connexion Discord est requise sur le site pour vérifier que vous êtes membre du serveur.*`;

        await interaction.editReply(msg);
        break;
      }

      // ── /download ──────────────────────────────────────

      // ── /collection ──────────────────────────────────────
      case 'collection': {
        const res = await apiGet('/collection?userId=' + interaction.user.id);
        if (!res || res.error) {
          await interaction.editReply('❌ ' + (res?.error || 'Erreur lors de la récupération de la collection.'));
          break;
        }

        const pct = Math.floor(res.globalPct * 100);
        let desc = '**Progression Globale : ' + pct + '%**\n*(Hors objets transcendants et liés au compte)*\n\n';

        for (const [catName, data] of Object.entries(res.categories)) {
          const catPct = Math.floor(data.pct * 100);
          desc += '**' + catName.toUpperCase() + ' :** ' + data.user + ' / ' + data.total + ' (' + catPct + '%)\n';
        }

        if (res.newRewards && res.newRewards.length > 0) {
          desc += '\n🎉 **Paliers atteints !** Tu as débloqué de nouveaux titres :\n';
          res.newRewards.forEach(r => desc += '- ' + r + '\n');
        }

        const embed = new EmbedBuilder()
          .setTitle('🖼️ Ta Collection')
          .setColor('#9b59b6')
          .setDescription(desc);

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      // ── /daily ───────────────────────────────────────────
      case 'daily': {
        const res = await apiPost('/daily', { userId: interaction.user.id });
        if (!res || res.error) {
          await interaction.editReply('❌ ' + (res?.error || 'Erreur inconnue.'));
          break;
        }

        const embed = new EmbedBuilder()
          .setTitle('📅 Récompense Quotidienne')
          .setColor('#2ecc71')
          .setDescription('Tu as réclamé ta récompense !\n\n🔥 **Série actuelle : ' + res.streak + ' jour(s)**\n\n**Gains :**\n' + res.rewards.map(r => '- ' + r).join('\n'));

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      // ── /fish ────────────────────────────────────────────
      case 'fish': {
        const subCmd = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        if (subCmd === 'catch') {
          const bait = interaction.options.getString('appat', true);

          // Animation start
          const animEmbed = new EmbedBuilder()
            .setTitle('🎣 Pêche')
            .setColor('#3498db')
            .setDescription('🎣 Tu lances ta ligne avec ton appât...');
          await interaction.editReply({ embeds: [animEmbed] });
          await new Promise(r => setTimeout(r, 1200));

          animEmbed.setDescription('🎣 ... ça mord ?');
          await interaction.editReply({ embeds: [animEmbed] });
          await new Promise(r => setTimeout(r, 1200));

          animEmbed.setDescription('🎣 ÇA MORD !!!');
          await interaction.editReply({ embeds: [animEmbed] });
          await new Promise(r => setTimeout(r, 1000));

          const res = await apiPost('/fish', { userId, bait });
          if (!res || res.error) {
            await interaction.editReply({ content: '🎣 ' + (res?.error || 'Erreur lors de la pêche.'), embeds: [] });
            break;
          }

          const embed = new EmbedBuilder()
            .setTitle('🎣 Pêche')
            .setColor('#3498db')
            .setDescription('Tu as attrapé :\n\n**' + res.item.name + '** ' + (res.item.emoji ? res.item.emoji : '🐟'));

          await interaction.editReply({ embeds: [embed] });
        } else if (subCmd === 'sell') {
          const fishId = interaction.options.getString('poisson', true);
          const quantityStr = interaction.options.getString('quantite') || '1';
          const res = await apiPost('/fish/sell', { userId, fishId, quantity: quantityStr });

          if (!res || res.error) {
            await interaction.editReply('❌ ' + (res?.error || 'Erreur lors de la vente.'));
            break;
          }

          if (res.amountSold === 0) {
             if (fishId === 'all') {
                await interaction.editReply('Tu n\'as aucun poisson à vendre dans ton inventaire.');
             } else {
                await interaction.editReply('Tu n\'as aucun poisson de ce type à vendre.');
             }
             break;
          }

          const description = fishId === 'all'
              ? `Tu as vendu **${res.amountSold}** poisson(s) de tous types pour **${res.coinsGained} BordelCoins** !`
              : `Tu as vendu **${res.amountSold}** poisson(s) pour **${res.coinsGained} BordelCoins** !`;

          const embed = new EmbedBuilder()
            .setTitle('💰 Poissonnerie')
            .setColor('#f1c40f')
            .setDescription(description);

          await interaction.editReply({ embeds: [embed] });
        }
        break;
      }

      // ── /slots ───────────────────────────────────────────
      case 'slots': {
        const bet = interaction.options.getInteger('mise');
        const res = await apiPost('/slots', { userId: interaction.user.id, amount: bet });
        if (!res || res.error) {
          await interaction.editReply({ content: '🎰 ' + (res?.error || 'Erreur de machine à sous.'), embeds: [] });
          break;
        }

        const buildDesc = (r1, r2, r3, finalMessage = '') => {
            return `Mise : ${bet} 💰\n\n╔════════════╗\n║  ${r1} | ${r2} | ${r3}  ║\n╚════════════╝\n\n${finalMessage}`;
        };

        const embed = new EmbedBuilder()
          .setTitle('🎰 Machine à Sous')
          .setColor('#95a5a6');

        // Animation Frame 1
        embed.setDescription(buildDesc('🔄', '🔄', '🔄', '*Les rouleaux tournent...*'));
        await interaction.editReply({ embeds: [embed] });
        await new Promise(r => setTimeout(r, 1000));

        // Animation Frame 2
        embed.setDescription(buildDesc(res.result[0], '🔄', '🔄', '*Les rouleaux tournent...*'));
        await interaction.editReply({ embeds: [embed] });
        await new Promise(r => setTimeout(r, 1000));

        // Animation Frame 3
        embed.setDescription(buildDesc(res.result[0], res.result[1], '🔄', '*Les rouleaux tournent...*'));
        await interaction.editReply({ embeds: [embed] });
        await new Promise(r => setTimeout(r, 1000));

        // Final Frame
        let finalMessage = '';
        if (res.winAmount > 0) {
           finalMessage = '🎉 **Gagné ! ' + res.winAmount + ' BordelCoins !**';
           if (res.isJackpot) finalMessage += ' \n🎰 **JACKPOT !!!!**';
        } else {
           finalMessage = '😢 Perdu.';
        }

        embed.setColor(res.winAmount > 0 ? '#f1c40f' : '#e74c3c')
             .setDescription(buildDesc(res.result[0], res.result[1], res.result[2], finalMessage));

        await interaction.editReply({ embeds: [embed] });
        break;
      }



        const subCmd = interaction.options.getSubcommand();



            // ── /roulette ─────────────────────────────────────────
      case 'roulette': {
        const bet = interaction.options.getInteger('mise', true);
        const res = await apiPost('/roulette/create', { userId: interaction.user.id, amount: bet });

        if (!res || res.error) {
           await interaction.editReply('❌ ' + (res?.error || 'Impossible de créer la roulette.'));
           break;
        }

        const embed = new EmbedBuilder()
          .setTitle('🔫 Buckshot Roulette Clandestine')
          .setColor('#000000')
          .setDescription(`Une partie de Buckshot Roulette est ouverte par <@${interaction.user.id}> !\n\n**Mise : ${bet} BordelCoins**\n\nLa partie commence dans **30 secondes**. Cliquez sur le bouton pour rejoindre !\n\n**Règles du jeu :**\n- Le fusil est chargé avec des vraies balles 🔴 et des balles à blanc ⚪.\n- À votre tour, choisissez sur qui tirer.\n- Si vous vous tirez dessus avec une balle à blanc, vous gagnez un tour gratuit !\n- Le dernier survivant rafle toute la mise.`);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('roulette_join_' + res.rouletteId)
            .setLabel('Rejoindre')
            .setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({ embeds: [embed], components: [row] });

        setTimeout(async () => {
           // Disable join button
           try {
             const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId('roulette_join_' + res.rouletteId)
                  .setLabel('Partie Démarrée')
                  .setStyle(ButtonStyle.Secondary)
                  .setDisabled(true)
             );
             await interaction.editReply({ components: [disabledRow] });
           } catch(e) {}

           const startRes = await apiPost('/roulette/start', { rouletteId: res.rouletteId });
           if (!startRes || startRes.error) {
              await interaction.followUp({ content: '❌ La roulette a été annulée : ' + (startRes?.error || 'Erreur inconnue.') });
              return;
           }

           const players = startRes.players;

           let gameMsg = `La partie de Buckshot commence avec **${players.length} joueurs** !\nChaque joueur a **${startRes.startingLives} vie(s)** 🩷.\n\n`;
           gameMsg += `Le fusil est chargé : **${startRes.liveCount} 🔴** (Vraies) et **${startRes.blankCount} ⚪** (Blanches).\nL'ordre des balles est inconnu.\n\n`;
           gameMsg += `C'est au tour de <@${startRes.turnPlayer}> de jouer.`;

           gameMsg += '\n\n**Vies restantes :**\n';
           for (const p of startRes.players) {
              gameMsg += `- <@${p}> : ${'🩷'.repeat(startRes.startingLives)}\n`;
           }

           const turnEmbed = new EmbedBuilder()
             .setTitle('🔫 Tour de Jeu')
             .setColor('#e74c3c')
             .setDescription(gameMsg);

           // On génère le menu de ciblage
           const targetOptions = await Promise.all(players.map(async pId => {
               let displayName = 'Joueur inconnu';
               try {
                   const member = await interaction.guild.members.fetch(pId);
                   displayName = member ? (member.displayName || member.user.username) : pId;
               } catch(e) { displayName = pId; }

               const livesText = '🩷'.repeat(startRes.startingLives);

               return {
                   label: pId === startRes.turnPlayer ? `[TOI] ${displayName} (${livesText})` : `${displayName} (${livesText})`,
                   value: pId,
                   description: pId === startRes.turnPlayer ? 'Me tirer dessus (Rejoue si ⚪)' : 'Tirer sur cet adversaire'
               };
           }));

           // Discord limit to 25 choices
           const selectMenu = new StringSelectMenuBuilder()
              .setCustomId('roulette_target_' + res.rouletteId)
              .setPlaceholder('Choisissez votre cible...')
              .addOptions(targetOptions.slice(0, 25));

           const actionRow = new ActionRowBuilder().addComponents(selectMenu);

           await interaction.followUp({ embeds: [turnEmbed], components: [actionRow] });

        }, 30 * 1000);
        break;
      }

      // ── /coinflip ────────────────────────────────────────
      case 'coinflip': {
        const target = interaction.options.getUser('joueur');
        const bet = interaction.options.getInteger('mise');

        if (target.id === interaction.user.id || target.bot) {
            await interaction.editReply("Tu ne peux pas parier contre toi-même ou un bot.");
            break;
        }

        const res = await apiPost('/coinflip/create', { userId: interaction.user.id, targetId: target.id, amount: bet });
        if (!res || res.error) {
          await interaction.editReply('❌ ' + (res?.error || 'Impossible de créer le pari.'));
          break;
        }

        const embed = new EmbedBuilder()
          .setTitle('🪙 Pari : Pile ou Face')
          .setColor('#e67e22')
          .setDescription('<@' + target.id + '>, <@' + interaction.user.id + '> te défie pour **' + bet + ' BordelCoins**.\n\nAcceptez-vous le pari ?');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('cf_accept_' + res.flipId)
            .setLabel('Accepter')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('cf_decline_' + res.flipId)
            .setLabel('Refuser')
            .setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({ content: '<@' + target.id + '>', embeds: [embed], components: [row] });
        break;
      }

      // ── /achievements ──────────────────────────────────────
      case 'achievements': {
         const res = await apiGet('/achievements?userId=' + interaction.user.id);
         if (!res || res.error) {
            await interaction.editReply("Impossible de récupérer tes succès.");
            break;
         }

         if (!res.achievements || res.achievements.length === 0) {
            await interaction.editReply("Aucun succès disponible.");
            break;
         }

         const ITEMS_PER_PAGE = 5;
         const pages = Math.ceil(res.achievements.length / ITEMS_PER_PAGE);
         let currentPage = 0;

         const generateEmbed = (page) => {
           const start = page * ITEMS_PER_PAGE;
           const currentItems = res.achievements.slice(start, start + ITEMS_PER_PAGE);

           const embed = new EmbedBuilder()
             .setTitle(`🏆 Liste des Succès (Page ${page + 1}/${pages})`)
             .setColor('#f1c40f');

           let desc = '';
           currentItems.forEach(a => {
             const icon = a.earned ? '✅' : '❌';
             if (!a.earned && a.secret) {
               desc += `${icon} **???** (Secret)\n*Description masquée*\n\n`;
             } else {
               const nameStyle = a.earned ? `**${a.name}**` : `~~${a.name}~~`;
               desc += `${icon} ${nameStyle} ${a.emoji || ''}\n*${a.desc}*\nMoyen d'obtention: ${a.howToObtain}\n\n`;
             }
           });

           embed.setDescription(desc || 'Rien ici.');
           return embed;
         };

         const getRow = (page) => {
           return new ActionRowBuilder().addComponents(
             new ButtonBuilder()
               .setCustomId('achiev_prev_' + interaction.user.id)
               .setLabel('⬅️ Précédent')
               .setStyle(ButtonStyle.Secondary)
               .setDisabled(page === 0),
             new ButtonBuilder()
               .setCustomId('achiev_next_' + interaction.user.id)
               .setLabel('Suivant ➡️')
               .setStyle(ButtonStyle.Secondary)
               .setDisabled(page === pages - 1)
           );
         };

         const message = await interaction.editReply({
           embeds: [generateEmbed(currentPage)],
           components: pages > 1 ? [getRow(currentPage)] : []
         });

         // Create a collector for the buttons
         if (pages > 1) {
           const filter = i => i.customId.startsWith('achiev_') && i.user.id === interaction.user.id;
           const collector = message.createMessageComponentCollector({ filter, time: 60000 });

           collector.on('collect', async i => {
             if (i.customId.includes('_prev_')) currentPage--;
             else if (i.customId.includes('_next_')) currentPage++;

             await i.update({
               embeds: [generateEmbed(currentPage)],
               components: [getRow(currentPage)]
             });
           });

           collector.on('end', async () => {
             // Disable buttons after timeout
             try {
                const disabledRow = getRow(currentPage);
                disabledRow.components.forEach(c => c.setDisabled(true));
                await interaction.editReply({ components: [disabledRow] });
             } catch(e) {}
           });
         }
         break;
      }

            // ── /craft ───────────────────────────────────────────
      case 'craft': {
         const targetId = interaction.options.getString('objet');
         const res = await apiPost('/craft', { userId: interaction.user.id, targetItemId: targetId });

         if (!res || res.error) {
            await interaction.editReply('❌ ' + (res?.error || 'Erreur lors du craft.'));
            break;
         }

         const embed = new EmbedBuilder()
          .setTitle('🛠️ Craft réussi !')
          .setColor('#3498db')
          .setDescription('Tu viens de fabriquer : **' + res.itemName + '** !');

        await interaction.editReply({ embeds: [embed] });
        break;
      }

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

      // ── /meme ──────────────────────────────────────────
      case 'meme': {
        const subCmd = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        if (subCmd === 'list') {
          const data = await apiGet(`/memes/${userId}`);
          const memes = data.memes || {};
          const memeNames = Object.keys(memes);

          if (memeNames.length === 0) {
            await interaction.editReply('📭 Vous n\'avez aucun mème personnel enregistré. Utilisez le bouton "💾 Mème" sur une vidéo ou image dans le salon de réputation.');
            return;
          }

          const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`😂 Mèmes personnels de ${interaction.user.displayName || interaction.user.username}`)
            .setDescription(`Vous avez **${memeNames.length}** mème(s) enregistré(s).`);

          let listText = memeNames.slice(0, 20).map(name => {
            const m = memes[name];
            const typeEmoji = m.type === 'video' ? '🎬' : (m.type === 'audio' ? '🎵' : '🖼️');
            return `**${name}** ${typeEmoji}`;
          }).join('\n');

          if (memeNames.length > 20) {
            listText += `\n*... et ${memeNames.length - 20} autres.*`;
          }

          embed.addFields({ name: 'Liste', value: listText });
          embed.setFooter({ text: 'Utilisez /meme play <nom> pour en lancer un !' });

          await interaction.editReply({ embeds: [embed] });
        }
        else if (subCmd === 'remove') {
          const memeName = interaction.options.getString('nom', true);
          try {
            const data = await apiDelete(`/memes/${userId}/${encodeURIComponent(memeName)}`);
            if (data.ok) {
              await interaction.editReply(`🗑️ Le mème **${memeName}** a été supprimé de votre collection.`);
            } else {
              await interaction.editReply(`❌ Erreur : ${data.error || 'Impossible de supprimer ce mème.'}`);
            }
          } catch (err) {
            await interaction.editReply('❌ Erreur serveur lors de la suppression.');
          }
        }
        else if (subCmd === 'play') {
          const memeName = interaction.options.getString('nom', true);
          const targetUser = interaction.options.getUser('cible');
          const target = targetUser ? targetUser.username : 'all';

          // 1. Fetch meme data
          const data = await apiGet(`/memes/${userId}`);
          const memes = data.memes || {};

          // Case-insensitive search just in case
          const lowerName = memeName.toLowerCase();
          const actualKey = Object.keys(memes).find(k => k.toLowerCase() === lowerName);
          const memeData = actualKey ? memes[actualKey] : null;

          if (!memeData) {
            await interaction.editReply(`❌ Le mème **${memeName}** n'existe pas dans votre collection.`);
            return;
          }

          const url = memeData.url;
          const senderName = interaction.user.displayName || interaction.user.username;
          const avatarUrl = interaction.user.displayAvatarURL({ size: 64, extension: 'png' });
          const caption = memeData.caption || '';
          const style = memeData.style || {};
          const greenscreen = memeData.greenscreen || false;
          const filter = memeData.filter || '';

          await interaction.editReply(`⏳ Chargement du mème **${memeName}** pour **${target === 'all' ? 'tout le monde' : target}**...`);

          // 2. Send via API
          // We decide between sendurl or sendfile based on the URL type.
          // If it's a direct discord attachment or our own media proxy, we can use sendfile.
          // Since all memes now have a direct URL (either external or copied locally), we can just use sendfile which handles direct URLs well.

          const sendRes = await apiPost('/sendfile', {
            fileUrl: url,
            fileType: memeData.type || 'video',
            target,
            caption,
            senderName,
            avatarUrl,
            ttsVoice: '', // TTS not saved with memes usually, but could be added later
            greenscreen,
            filter,
            userId,
            color: style.color,
            font: style.font,
            animation: style.animation,
            effect: style.effect
          });

          if (sendRes.error) {
            await interaction.editReply(`❌ Erreur lors de l'envoi du mème : ${sendRes.error}`);
            return;
          }

          await interaction.editReply(`✅ Mème **${memeName}** envoyé à **${target === 'all' ? 'tout le monde' : target}** !`);
          updatePresence();

          // Optional: we can log the reputation for meme plays too, but it might spam. Let's log it.
          await sendReputationLog(interaction, 'Mème Joué', `**Cible :** ${target === 'all' ? 'Tout le monde' : target}\n**Mème :** ${memeName}\n**Texte :** ${caption || '*Aucun*'}`, null, memeData);
        }
        break;
      }

      // ── /tuto ──────────────────────────────────────────
      case 'tuto': {
        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('🗃️ Bienvenue sur BordelBox !')
          .setDescription('BordelBox permet d\'afficher des médias et messages en direct sur les écrans connectés via l\'overlay client.')
          .setThumbnail(client.user.displayAvatarURL({ size: 128 }))
          .addFields(
            {
              name: '🚀 Commandes d\'Envoi',
              value: '`/sendurl` : Envoie une vidéo YouTube ou lien.\n`/sendfile` : Uploade un fichier (max 250 Mo).\n`/message` : Affiche un texte animé.\n`/ai` : Génère un message avec l\'IA.'
            },
            {
              name: '😂 Mèmes & Profils',
              value: '`/meme play` : Lance un mème enregistré via le bouton "💾 Mème".\n`/profile` : Affiche stats et équipements.'
            },
            {
              name: '⭐ Économie & Mini-Jeux',
              value: '`/daily` : Récompense quotidienne\n`/fish` : Pêche des poissons avec des appâts.\n`/slots` : Machine à sous.\n`/arena` : Combat 1v1 d\'objets.\n`/roulette` : Buckshot Roulette.\n`/coinflip` : Pari contre un autre joueur.\n`/achievements` : Voir vos succès.'
            },
            {
              name: '💼 Inventaire & Marché',
              value: '`/lootbox` : Acheter et ouvrir des caisses.\n`/inventory` : Gérer vos objets et les équiper.\n`/market` : Vendre et acheter avec les joueurs.\n`/craft` : Créer des cannes à pêche.'
            },
            {
              name: '🔧 Utilitaires',
              value: '`/queue`, `/style`, `/dashboard`, `/info <sujet>`'
            }
          )
          .setFooter({ text: 'Utilisez /info <sujet> pour plus de détails spécifiques !' })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      // ── /info ──────────────────────────────────────────
      case 'info': {
        const subject = interaction.options.getString('sujet', true);
        const embed = new EmbedBuilder().setColor(0x0099FF);

        switch (subject) {
          case 'economy':
            embed.setTitle('💰 Économie & BordelCoins')
                 .setDescription('Les **BordelCoins** sont la monnaie de la BordelBox.\n\n**Comment en gagner ?**\n- Les upvotes dans le salon réputation 👍\n- La commande `/daily` tous les jours\n- Vaincre un `/event boss` (nécessite l\'overlay ouvert)\n- La pêche (`/fish`), machine à sous (`/slots`), paris (`/coinflip`), `/arena` et `/roulette`\n- Vendre vos objets sur le `/market`\n\n**Que faire avec ?**\n- Acheter des effets visuels dans le `/shop`\n- Acheter des lootboxes (`/lootbox buy`)\n- Acheter de meilleurs appâts pour `/fish` ou des cannes à pêche (`/craft`)');
            break;
          case 'fishing':
            embed.setTitle('🎣 Guide de la Pêche')
                 .setDescription('Utilise `/fish <appât>` pour pêcher.\n\n- Les **appâts** (Ver, Crevette, Calamar) coûtent des BordelCoins mais augmentent tes chances d\'attraper des objets rares.\n- Tu peux attraper des déchets (0 💰), des poissons variés, ou même des **Lootboxes** (1% de chance) !\n- Les poissons pêchés vont dans ton `/inventory` et peuvent être vendus.\n- Tu peux réduire le temps d\'attente entre 2 pêches en fabriquant une meilleure canne avec `/craft`.\n\n**Probabilités par appât :**\n- **Ver (Base) :** 🗑️ 40%, 🐟 Morue 30%, 🍣 Saumon 15%, 🐠 Thon 10%, 🦈 Requin 4%, 🐙 Kraken 0.9%, 🎁 Lootbox 0.1%\n- **Crevette :** Réduit un peu les déchets, augmente les chances pour le Thon (x1.5), le Requin, le Kraken et la Lootbox (x2).\n- **Calamar :** Réduit drastiquement les déchets (x0.2), boost énorme sur les poissons rares et la Lootbox (x3 à x5).');
            break;
          case 'slots':
            embed.setTitle('🎰 Machine à Sous')
                 .setDescription('Utilise `/slots <mise>` pour parier tes BordelCoins.\n\n- **2 symboles identiques** (41.6% de chance) = x1.5 ta mise.\n- **3 symboles identiques** (2.7% de chance) = x5 à x25 ta mise selon le symbole (💎 = x25, 🔔 = x15).\n- Aligner 3 💎 déclenche un **JACKPOT**.\n- Gagner plusieurs jackpots de suite débloque des succès secrets et des titres uniques (`/achievements`) !');
            break;
          case 'lootbox':
            embed.setTitle('🎁 Probabilités des Lootboxes')
                 .setDescription('Voici les probabilités exactes pour les objets obtenus en ouvrant des Lootboxes (`/lootbox open`) :\n\n- ⬜ **Commun :** 60%\n- 🟦 **Rare :** 25%\n- 🟪 **Épique :** 10%\n- 🟨 **Légendaire :** 4%\n- 🟥 **Mythique :** 0.7%\n- 🌟 **Transcendant :** 0.3% (Génère un objet procédural unique avec un numéro de série !)\n\n*(Note: un jackpot en pièces ou un titre unique peut tomber sous ces probabilités de rareté).*');
            break;
          case 'market':
            embed.setTitle('🛒 Le Marché Communautaire')
                 .setDescription('Le marché permet aux joueurs d\'échanger leurs objets contre des BordelCoins.\n\n- `/market list` : Voir les objets en vente actuellement.\n- `/market sell <objet> <prix>` : Mettre en vente un objet de ton inventaire. Tu choisis le prix !\n- `/market buy <id>` : Acheter l\'objet correspondant.\n- `/market cancel <id>` : Annuler ta vente et récupérer ton objet.\n\n*(Note : Certains titres/objets liés au compte comme les récompenses de succès ne peuvent pas être vendus).*');
            break;
          case 'craft':
            embed.setTitle('🛠️ Système de Craft')
                 .setDescription('Le craft te permet de fusionner des BordelCoins avec tes anciens objets pour en créer de meilleurs.\n\n**Cannes à pêche :**\n- Canne en bois = Par défaut (40s cooldown)\n- Canne en fer = Bois + 1000 💰 (30s cooldown)\n- Canne en or = Fer + 5000 💰 (20s cooldown)\n- Canne en diamant = Or + 15000 💰 (15s cooldown)\n\nUtilise `/craft <objet>` pour fabriquer !');
            break;
        }

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      default:
        await interaction.editReply('❓ Commande inconnue.');
    }

        if (!interaction.isAutocomplete()) {
          try {
            await checkUserNotifications(interaction, interaction.user.id);
          } catch(e) {}
        }

  } catch (err) {
    console.error(`[Bot Error] ${commandName}:`, err.message);
    const msg = `❌ Impossible de contacter le serveur BordelBox.\n\`${err.message}\``;
    if (interaction.deferred) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ content: msg, flags: [MessageFlags.Ephemeral] }).catch(() => {});
    }
  }
});

// ─── Connexion ───────────────────────────────────────────

client.login(TOKEN);

// Ajouter le traitement des nouvelles commandes à la fin de client.on('interactionCreate')
// je vais injecter ça proprement au bon endroit.
