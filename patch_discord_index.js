const fs = require('fs');

let code = fs.readFileSync('discord-bot/index.js', 'utf8');

// 1. Add Autocomplete for `/arena`
const autocompleteRegex = /interaction\.commandName === 'inventory' \|\| interaction\.commandName === 'market' \|\| interaction\.commandName === 'fish'/;
code = code.replace(autocompleteRegex, "interaction.commandName === 'inventory' || interaction.commandName === 'market' || interaction.commandName === 'fish' || interaction.commandName === 'arena'");

// 2. Add DeferReply for `/arena`
const deferRegex = /interaction\.commandName === 'achievements' \|\| interaction\.commandName === 'craft'\)/;
code = code.replace(deferRegex, "interaction.commandName === 'achievements' || interaction.commandName === 'craft' || interaction.commandName === 'arena')");

// 3. Add Arena Command Handling
const commandHandlingRegex = /\/\/ ── \/coinflip ────────────────────────────────────────/;
const arenaCode = `// ── /arena ───────────────────────────────────────────
      case 'arena': {
        const subCmd = interaction.options.getSubcommand();

        if (subCmd === 'challenge') {
          const target = interaction.options.getUser('joueur');
          const bet = interaction.options.getInteger('mise');
          const userItem = interaction.options.getString('objet', true);

          if (target.id === interaction.user.id || target.bot) {
              await interaction.editReply("Tu ne peux pas défier toi-même ou un bot.");
              break;
          }

          const res = await apiPost('/arena/create', { userId: interaction.user.id, targetId: target.id, amount: bet, userItemId: userItem });
          if (!res || res.error) {
            await interaction.editReply('❌ ' + (res?.error || 'Impossible de créer le défi.'));
            break;
          }

          const embed = new EmbedBuilder()
            .setTitle('⚔️ Défi d\\'Arène Clandestine')
            .setColor('#e74c3c')
            .setDescription('<@' + target.id + '>, <@' + interaction.user.id + '> te défie dans l\\'arène pour **' + bet + ' BordelCoins** avec son objet **' + userItem + '** !\\n\\nAcceptez-vous le défi en choisissant votre arme ?');

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('arena_accept_' + res.arenaId)
              .setLabel('Accepter')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId('arena_decline_' + res.arenaId)
              .setLabel('Refuser')
              .setStyle(ButtonStyle.Danger)
          );

          await interaction.editReply({ content: '<@' + target.id + '>', embeds: [embed], components: [row] });
        } else if (subCmd === 'accept') {
          // Fallback if needed, but handled mostly via buttons? No, wait, if they need to select an item to accept, they can't do it just by clicking a button.
          // Let's change the button 'arena_accept' to reply with a message telling them to use \`/arena accept <id> <item>\`.
          const arenaId = interaction.options.getString('id', true);
          const targetItem = interaction.options.getString('objet', true);

          const res = await apiPost('/arena/accept', { arenaId: arenaId, userId: interaction.user.id, targetItemId: targetItem });
          if (!res || res.error) {
            await interaction.editReply('❌ ' + (res?.error || 'Impossible d\\'accepter le défi.'));
            break;
          }

          // Fetch items for nicer display
          const creatorItemName = res.creatorItemInfo ? res.creatorItemInfo.name : 'Arme secrète';
          const targetItemName = res.targetItemInfo ? res.targetItemInfo.name : targetItem;

          let desc = \`Le combat fait rage entre <@\${res.winner}> et <@\${res.loser}> !\\n\\n\`;
          desc += \`Vainqueur : <@\${res.winner}> !\\n\`;
          desc += \`Gains : **\${res.payout} BordelCoins** (Taxe: \${res.tax})\\n\`;

          if (res.itemStolen) {
             desc += \`\\n🚨 **INCROYABLE !** Le vainqueur a racketté l'objet **\${res.loserItemId}** du perdant !\`;
          }

          const embed = new EmbedBuilder()
            .setTitle('⚔️ Résultat de l\\'Arène')
            .setColor('#e74c3c')
            .setDescription(desc);

          await interaction.editReply({ embeds: [embed] });

          // Trigger overlay if big fight
          const creatorRarity = res.creatorItemInfo ? res.creatorItemInfo.rarity : 'commun';
          const targetRarity = res.targetItemInfo ? res.targetItemInfo.rarity : 'commun';
          const highRarities = ['legendaire', 'mythique', 'transcendant'];

          if (res.amount >= 100 || highRarities.includes(creatorRarity) || highRarities.includes(targetRarity)) {
             const overlayText = \`COMBAT CLANDESTIN:\\nLe \${creatorItemName} affronte le \${targetItemName}... Et le vainqueur rafle tout !\`;
             await apiPost('/message', {
                text: overlayText,
                target: 'all',
                senderName: 'L\\'Arène',
                userId: interaction.user.id,
                color: '#e74c3c',
                font: 'Impact',
                animation: 'shake'
             });
          }
        }
        break;
      }

      // ── /coinflip ────────────────────────────────────────`;

code = code.replace("// ── /coinflip ────────────────────────────────────────", arenaCode);

// 4. Add Button handlers
const buttonRegex = /if \(customId\.startsWith\('skip_'\)\) \{/;
const buttonHandlers = `if (customId.startsWith('arena_accept_') || customId.startsWith('arena_decline_')) {
      const isAccept = customId.startsWith('arena_accept_');
      const arenaId = customId.replace('arena_accept_', '').replace('arena_decline_', '');

      if (!isAccept) {
        await apiPost('/arena/cancel', { arenaId });
        await interaction.update({ content: 'Défi refusé ou annulé.', embeds: [], components: [] });
        return;
      }

      await interaction.reply({ content: \`Pour accepter le combat, tu dois choisir ton arme avec la commande : \\\`/arena accept \\\${arenaId} <ton_objet>\\\`\`, ephemeral: true });
      return;
    }

    if (customId.startsWith('skip_')) {`;

code = code.replace("if (customId.startsWith('skip_')) {", buttonHandlers);

fs.writeFileSync('discord-bot/index.js', code);
