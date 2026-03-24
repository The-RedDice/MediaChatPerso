const fs = require('fs');
let code = fs.readFileSync('discord-bot/index.js', 'utf8');

const newCommandsCode = `
      // ── /collection ──────────────────────────────────────
      case 'collection': {
        const res = await apiGet('/api/collection?userId=' + interaction.user.id);
        if (!res || res.error) {
          await interaction.editReply('❌ ' + (res?.error || 'Erreur lors de la récupération de la collection.'));
          break;
        }

        const pct = Math.floor(res.globalPct * 100);
        let desc = '**Progression Globale : ' + pct + '%**' + '\n*(Hors objets transcendants et liés au compte)*\n\n';

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
        const res = await apiPost('/api/daily', { userId: interaction.user.id });
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
        const bait = interaction.options.getString('appat');
        const res = await apiPost('/api/fish', { userId: interaction.user.id, bait });
        if (!res || res.error) {
          await interaction.editReply('🎣 ' + (res?.error || 'Erreur lors de la pêche.'));
          break;
        }

        const embed = new EmbedBuilder()
          .setTitle('🎣 Pêche')
          .setColor('#3498db')
          .setDescription('Tu as attrapé :\n\n**' + res.item.name + '** ' + (res.item.emoji ? res.item.emoji : '🐟'));

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      // ── /slots ───────────────────────────────────────────
      case 'slots': {
        const bet = interaction.options.getInteger('mise');
        const res = await apiPost('/api/slots', { userId: interaction.user.id, amount: bet });
        if (!res || res.error) {
          await interaction.editReply('🎰 ' + (res?.error || 'Erreur de machine à sous.'));
          break;
        }

        let desc = 'Mise : ' + bet + ' 💰\n\n' +
                   '╔════════════╗\n' +
                   '║  ' + res.result.join(' | ') + '  ║\n' +
                   '╚════════════╝\n\n';

        if (res.winAmount > 0) {
           desc += '🎉 **Gagné ! ' + res.winAmount + ' BordelCoins !**';
           if (res.isJackpot) desc += ' \n🎰 **JACKPOT !!!!**';
        } else {
           desc += '😢 Perdu.';
        }

        const embed = new EmbedBuilder()
          .setTitle('🎰 Machine à Sous')
          .setColor(res.winAmount > 0 ? '#f1c40f' : '#e74c3c')
          .setDescription(desc);

        await interaction.editReply({ embeds: [embed] });
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

        const res = await apiPost('/api/coinflip/create', { userId: interaction.user.id, targetId: target.id, amount: bet });
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
         const res = await apiGet('/api/achievements?userId=' + interaction.user.id);
         if (!res || res.error) {
            await interaction.editReply("Impossible de récupérer tes succès.");
            break;
         }

         const embed = new EmbedBuilder()
          .setTitle('🏆 Succès Débloqués')
          .setColor('#f1c40f')
          .setDescription(res.achievements.length > 0 ? res.achievements.map(a => '- ' + a.name + ' ' + (a.emoji||'')).join('\n') : 'Aucun succès pour le moment.');

        await interaction.editReply({ embeds: [embed] });
        break;
      }
`;

code = code.replace(/case 'download': \{/, newCommandsCode + '\n      case \'download\': {');

fs.writeFileSync('discord-bot/index.js', code);
