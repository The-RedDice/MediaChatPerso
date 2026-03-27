const fs = require('fs');
let code = fs.readFileSync('discord-bot/index.js', 'utf8');

const rouletteCode = `// ── /roulette ─────────────────────────────────────────
      case 'roulette': {
        const bet = interaction.options.getInteger('mise', true);
        const res = await apiPost('/roulette/create', { userId: interaction.user.id, amount: bet });

        if (!res || res.error) {
           await interaction.editReply('❌ ' + (res?.error || 'Impossible de créer la roulette.'));
           break;
        }

        const embed = new EmbedBuilder()
          .setTitle('🔫 Roulette Russe Clandestine')
          .setColor('#000000')
          .setDescription(\`Une partie de Roulette Russe est ouverte par <@\${interaction.user.id}> !\\n\\n**Mise : \${bet} BordelCoins**\\n\\nLa partie commence dans **30 secondes**. Cliquez sur le bouton pour rejoindre !\`);

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
           let currentAlive = [...players];

           await interaction.followUp({ content: \`La Roulette commence avec **\${players.length} joueurs** ! Le barillet tourne...\` });

           // Simulate rounds
           const simulateRound = async () => {
              await new Promise(r => setTimeout(r, 3000));
              const shootRes = await apiPost('/roulette/shoot', { rouletteId: res.rouletteId });

              if (!shootRes || shootRes.error) {
                 await interaction.followUp({ content: '❌ Erreur de la roulette.' });
                 return;
              }

              if (shootRes.state === 'finished') {
                 const winEmbed = new EmbedBuilder()
                   .setTitle('🔫 Fin de la Roulette')
                   .setColor('#2ecc71')
                   .setDescription(\`**PAN !** <@\${shootRes.victim}> s'est pris une balle !\\n\\n🎉 <@\${shootRes.winner}> est le seul survivant et rafle le pactole de **\${shootRes.payout} BordelCoins** (Taxe: \${shootRes.tax}) !\`);
                 await interaction.followUp({ embeds: [winEmbed] });
                 return;
              }

              if (shootRes.state === 'draw_proposed') {
                 currentAlive = shootRes.alive;
                 const drawEmbed = new EmbedBuilder()
                   .setTitle('🔫 Proposition d\\'Égalité')
                   .setColor('#f1c40f')
                   .setDescription(\`**PAN !** <@\${shootRes.victim}> s'est pris une balle !\\n\\nIl ne reste plus que <@\${currentAlive[0]}> et <@\${currentAlive[1]}> !\\n\\nVoulez-vous partager le pactole ou continuer à jouer avec votre vie ?\`);

                 const drawRow = new ActionRowBuilder().addComponents(
                   new ButtonBuilder()
                     .setCustomId('roulette_draw_yes_' + res.rouletteId)
                     .setLabel('Partager')
                     .setStyle(ButtonStyle.Success),
                   new ButtonBuilder()
                     .setCustomId('roulette_draw_no_' + res.rouletteId)
                     .setLabel('Continuer à tirer')
                     .setStyle(ButtonStyle.Danger)
                 );

                 await interaction.followUp({ embeds: [drawEmbed], components: [drawRow] });
                 return;
              }

              if (shootRes.state === 'playing') {
                 await interaction.followUp({ content: \`**PAN !** <@\${shootRes.victim}> s'est pris une balle ! Il reste **\${shootRes.alive.length} joueurs** en vie. Le barillet tourne encore...\` });
                 simulateRound();
              }
           };

           simulateRound();

        }, 30 * 1000);
        break;
      }

      // ── /arena ───────────────────────────────────────────`;

code = code.replace("// ── /arena ───────────────────────────────────────────", rouletteCode);

const rouletteButtons = `if (customId.startsWith('roulette_join_')) {
      const rouletteId = customId.replace('roulette_join_', '');
      const res = await apiPost('/roulette/join', { rouletteId, userId: interaction.user.id });
      if (res.error) {
         await interaction.reply({ content: '❌ ' + res.error, ephemeral: true });
      } else {
         await interaction.reply({ content: \`✅ Tu as rejoint la partie de Roulette (\${res.playersCount} joueurs inscrits) !\`, ephemeral: true });
      }
      return;
    }

    if (customId.startsWith('roulette_draw_yes_') || customId.startsWith('roulette_draw_no_')) {
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
         await interaction.followUp({ embeds: [drawEmbed] });
      } else if (res.drawAccepted === false) {
         // One player declined. Resume game.
         await interaction.followUp({ content: 'Le barillet tourne de nouveau...' });

         // Trigger next shoot
         setTimeout(async () => {
             const shootRes = await apiPost('/roulette/shoot', { rouletteId });
             if (shootRes && shootRes.state === 'finished') {
                const winEmbed = new EmbedBuilder()
                   .setTitle('🔫 Fin de la Roulette')
                   .setColor('#2ecc71')
                   .setDescription(\`**PAN !** <@\${shootRes.victim}> s'est pris une balle !\\n\\n🎉 <@\${shootRes.winner}> est le seul survivant et rafle le pactole de **\${shootRes.payout} BordelCoins** (Taxe: \${shootRes.tax}) !\`);
                 await interaction.followUp({ embeds: [winEmbed] });
             }
         }, 3000);
      }
      return;
    }

    if (customId.startsWith('arena_accept_') || customId.startsWith('arena_decline_')) {`;

code = code.replace("if (customId.startsWith('arena_accept_') || customId.startsWith('arena_decline_')) {", rouletteButtons);
fs.writeFileSync('discord-bot/index.js', code);
