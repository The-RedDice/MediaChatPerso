const fs = require('fs');

let code = fs.readFileSync('discord-bot/index.js', 'utf8');

const arenaCode = `      // ── /arena ───────────────────────────────────────────
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
          const arenaId = interaction.options.getString('id', true);
          const targetItem = interaction.options.getString('objet', true);

          const res = await apiPost('/arena/accept', { arenaId: arenaId, userId: interaction.user.id, targetItemId: targetItem });
          if (!res || res.error) {
            await interaction.editReply('❌ ' + (res?.error || 'Impossible d\\'accepter le défi.'));
            break;
          }

          const creatorItemName = res.creatorItemInfo ? res.creatorItemInfo.name : 'Arme secrète';
          const targetItemName = res.targetItemInfo ? res.targetItemInfo.name : targetItem;

          let desc = \`Le combat fait rage entre <@\${res.winner}> et <@\${res.loser}> !\\n\\n\`;
          desc += \`Vainqueur : <@\${res.winner}> !\\n\`;
          desc += \`Gains : **\${res.payout} BordelCoins** (Taxe: \${res.tax})\\n\`;

          if (res.itemStolen) {
             desc += \`\\n🚨 **INCROYABLE !** Le vainqueur a racketté l'objet du perdant !\`;
          }

          const embed = new EmbedBuilder()
            .setTitle('⚔️ Résultat de l\\'Arène')
            .setColor('#e74c3c')
            .setDescription(desc);

          await interaction.editReply({ embeds: [embed] });

          const creatorRarity = res.creatorItemInfo ? res.creatorItemInfo.rarity : 'commun';
          const targetRarity = res.targetItemInfo ? res.targetItemInfo.rarity : 'commun';
          const highRarities = ['legendaire', 'mythique', 'transcendant'];

          if (res.amount >= 100 || highRarities.includes(creatorRarity) || highRarities.includes(targetRarity)) {
             const overlayText = \`⚔️ ARÈNE:\\n\${creatorItemName} VS \${targetItemName}...\\nLe vainqueur rafle tout !\`;
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

code = code.replace("// ── /arena ───────────────────────────────────────────", "");
code = code.replace("case 'arena': {", "");
code = code.replace(/        if \(subCmd === 'challenge'\) \{[\s\S]*?break;\n      \}/, "");
// Removing the mess I made and putting it correctly

const toReplace = `      // ── /coinflip ────────────────────────────────────────`;
code = code.replace(toReplace, arenaCode);

fs.writeFileSync('discord-bot/index.js', code);
