const fs = require('fs');
let code = fs.readFileSync('discord-bot/index.js', 'utf8');

const rouletteCode = `      // ── /roulette ─────────────────────────────────────────
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
          .setDescription(\`Une partie de Buckshot Roulette est ouverte par <@\${interaction.user.id}> !\\n\\n**Mise : \${bet} BordelCoins**\\n\\nLa partie commence dans **30 secondes**. Cliquez sur le bouton pour rejoindre !\\n\\n**Règles du jeu :**\\n- Le fusil est chargé avec des vraies balles 🔴 et des balles à blanc ⚪.\\n- À votre tour, choisissez sur qui tirer.\\n- Si vous vous tirez dessus avec une balle à blanc, vous gagnez un tour gratuit !\\n- Le dernier survivant rafle toute la mise.\`);

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

           let gameMsg = \`La partie de Buckshot commence avec **\${players.length} joueurs** !\\n\\n\`;
           gameMsg += \`Le fusil est chargé : **\${startRes.liveCount} 🔴** (Vraies) et **\${startRes.blankCount} ⚪** (Blanches).\\nL'ordre des balles est inconnu.\\n\\n\`;
           gameMsg += \`C'est au tour de <@\${startRes.turnPlayer}> de jouer.\`;

           const turnEmbed = new EmbedBuilder()
             .setTitle('🔫 Tour de Jeu')
             .setColor('#e74c3c')
             .setDescription(gameMsg);

           // On génère le menu de ciblage
           const targetOptions = players.map(pId => ({
               label: pId === startRes.turnPlayer ? 'Me tirer dessus (Rejoue si ⚪)' : \`Tirer sur un adversaire\`,
               value: pId,
               description: pId === startRes.turnPlayer ? 'Risqué mais récompense d\\'un tour' : 'Éliminer une menace'
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

      // ── /coinflip ────────────────────────────────────────`;

const replaceBlock = /\/\/ ── \/roulette ─────────────────────────────────────────[\s\S]*?\/\/ ── \/coinflip ────────────────────────────────────────/;
code = code.replace(replaceBlock, rouletteCode);

const stringMenuLogic = `if (interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
    const customId = interaction.customId;
    const userId = interaction.user.id;
    const username = interaction.user.displayName || interaction.user.username;

    if (customId.startsWith('roulette_target_')) {
        const rouletteId = customId.replace('roulette_target_', '');
        const targetId = interaction.values[0];

        const shootRes = await apiPost('/roulette/shoot', { rouletteId, shooterId: userId, targetId });

        if (shootRes.error) {
            await interaction.reply({ content: '❌ ' + shootRes.error, ephemeral: true });
            return;
        }

        // Action was successful, we need to update the game state for everyone.
        // We delete the current component row so no one else can click it.
        await interaction.update({ components: [] });

        const isLive = shootRes.isLive;
        const isSelf = shootRes.isSelf;
        const victimDied = shootRes.victimDied;

        let resultMsg = \`<@\${userId}> pointe le fusil sur \${isSelf ? '**LUI-MÊME**' : \`<@\${targetId}>\`} et presse la détente...\\n\\n\`;

        if (isLive) {
            resultMsg += \`💥 **BAM ! C'était une vraie balle 🔴 !**\\n\`;
            if (isSelf) {
               resultMsg += \`<@\${userId}> s'effondre.\\n\`;
            } else {
               resultMsg += \`<@\${targetId}> s'effondre.\\n\`;
            }
        } else {
            resultMsg += \`*Clic.* **C'était une balle à blanc ⚪.**\\n\`;
            if (isSelf) {
               resultMsg += \`<@\${userId}> sourit. Il gagne un tour supplémentaire !\\n\`;
            } else {
               resultMsg += \`<@\${targetId}> a eu de la chance.\\n\`;
            }
        }

        if (shootRes.state === 'finished') {
           const winEmbed = new EmbedBuilder()
             .setTitle('🔫 Fin de la Partie')
             .setColor('#2ecc71')
             .setDescription(resultMsg + \`\\n🎉 <@\${shootRes.winner}> est le dernier survivant et rafle le pactole de **\${shootRes.payout} BordelCoins** (Taxe: \${shootRes.tax}) !\`);
           await interaction.followUp({ embeds: [winEmbed] });
           return;
        }

        if (shootRes.state === 'draw_proposed') {
           const drawEmbed = new EmbedBuilder()
             .setTitle('🔫 Proposition d\\'Égalité')
             .setColor('#f1c40f')
             .setDescription(resultMsg + \`\\nIl ne reste plus que <@\${shootRes.alive[0]}> et <@\${shootRes.alive[1]}> en vie !\\n\\nVoulez-vous partager le pactole ou continuer le massacre ?\`);

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
           let nextTurnMsg = resultMsg + '\\n';
           if (shootRes.reloaded) {
              nextTurnMsg += \`🔄 **Le fusil était vide ! On recharge : \${shootRes.liveCount} 🔴 et \${shootRes.blankCount} ⚪.**\\n\\n\`;
           } else {
              nextTurnMsg += \`(Il reste \${shootRes.liveCount} 🔴 et \${shootRes.blankCount} ⚪ dans le chargeur)\\n\\n\`;
           }

           nextTurnMsg += \`C'est au tour de <@\${shootRes.nextPlayer}> de jouer.\`;

           const turnEmbed = new EmbedBuilder()
             .setTitle('🔫 Tour Suivant')
             .setColor('#e74c3c')
             .setDescription(nextTurnMsg);

           // Recreate target options
           const stateRes = await apiGet(\`/roulette/state?rouletteId=\${rouletteId}\`);

           if (!stateRes || stateRes.error) {
               await interaction.followUp('Erreur de synchro.');
               return;
           }

           const targetOptions = stateRes.alivePlayers.map(pId => ({
               label: pId === stateRes.turnPlayer ? 'Me tirer dessus (Rejoue si ⚪)' : \`Tirer sur un adversaire\`,
               value: pId,
               description: pId === stateRes.turnPlayer ? 'Risqué mais récompense d\\'un tour' : 'Éliminer une menace'
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

    let payload = { username };`;

code = code.replace(/if \(interaction\.isStringSelectMenu\(\) \|\| interaction\.isModalSubmit\(\)\) \{\n    const customId = interaction\.customId;\n    const userId = interaction\.user\.id;\n    const username = interaction\.user\.displayName \|\| interaction\.user\.username;\n\n    let payload = \{ username \};/, stringMenuLogic);

const drawLogic = `if (customId.startsWith('roulette_draw_yes_') || customId.startsWith('roulette_draw_no_')) {
      const vote = customId.startsWith('roulette_draw_yes_');
      const rouletteId = customId.replace('roulette_draw_yes_', '').replace('roulette_draw_no_', '');
      const res = await apiPost('/roulette/vote', { rouletteId, userId: interaction.user.id, vote });

      if (res.error) {
         await interaction.reply({ content: '❌ ' + res.error, ephemeral: true });
         return;
      }

      await interaction.reply({ content: vote ? '✅ Tu as voté pour l\\'égalité.' : '🔫 Tu as refusé l\\'égalité. Que le bain de sang reprenne !', ephemeral: false });

      if (res.drawAccepted === true) {
         const drawEmbed = new EmbedBuilder()
           .setTitle('🤝 Égalité Acceptée')
           .setColor('#3498db')
           .setDescription(\`Les survivants se sont mis d'accord.\\n\\nChacun repart avec **\${res.payout} BordelCoins** !\`);
         await interaction.followUp({ embeds: [drawEmbed], components: [] });
      } else if (res.drawAccepted === false) {
         // One player declined. Resume game.
         let resumeMsg = \`<@\${interaction.user.id}> a refusé l'égalité !\\n\\n\`;
         if (res.reloaded) {
             resumeMsg += \`🔄 **Le fusil était vide ! On recharge : \${res.liveCount} 🔴 et \${res.blankCount} ⚪.**\\n\\n\`;
         } else {
             resumeMsg += \`(Il reste \${res.liveCount} 🔴 et \${res.blankCount} ⚪ dans le chargeur)\\n\\n\`;
         }
         resumeMsg += \`C'est au tour de <@\${res.nextPlayer}> de jouer.\`;

         const turnEmbed = new EmbedBuilder()
             .setTitle('🔫 La partie reprend')
             .setColor('#e74c3c')
             .setDescription(resumeMsg);

           const stateRes = await apiGet(\`/roulette/state?rouletteId=\${rouletteId}\`);

           const targetOptions = stateRes.alivePlayers.map(pId => ({
               label: pId === stateRes.turnPlayer ? 'Me tirer dessus (Rejoue si ⚪)' : \`Tirer sur un adversaire\`,
               value: pId,
               description: pId === stateRes.turnPlayer ? 'Risqué mais récompense d\\'un tour' : 'Éliminer une menace'
           }));

           const selectMenu = new StringSelectMenuBuilder()
              .setCustomId('roulette_target_' + rouletteId)
              .setPlaceholder('Choisissez votre cible...')
              .addOptions(targetOptions.slice(0, 25));

           const actionRow = new ActionRowBuilder().addComponents(selectMenu);

         await interaction.followUp({ embeds: [turnEmbed], components: [actionRow] });
      }
      return;
    }`;

code = code.replace(/if \(customId\.startsWith\('roulette_draw_yes_'\) \|\| customId\.startsWith\('roulette_draw_no_'\)\) \{[\s\S]*?return;\n    \}/, drawLogic);

fs.writeFileSync('discord-bot/index.js', code);
