const fs = require('fs');
let code = fs.readFileSync('discord-bot/index.js', 'utf8');

const newButtonCode = `
    // --- Coinflip Buttons ---
    if (customId.startsWith('cf_accept_') || customId.startsWith('cf_decline_')) {
      const isAccept = customId.startsWith('cf_accept_');
      const flipId = customId.replace('cf_accept_', '').replace('cf_decline_', '');

      if (!isAccept) {
        await apiPost('/api/coinflip/cancel', { flipId });
        await interaction.update({ content: 'Pari refusé ou annulé.', embeds: [], components: [] });
        return;
      }

      const res = await apiPost('/api/coinflip/accept', { flipId, userId: interaction.user.id });
      if (!res || res.error) {
        await interaction.reply({ content: '❌ ' + (res?.error || 'Erreur lors de l\\'acceptation.'), ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🪙 Résultat du Pile ou Face !')
        .setColor('#e67e22')
        .setDescription(
          '<@' + res.winner + '> gagne contre <@' + res.loser + '> !\n\n' +
          'Mise : **' + res.amount + ' BordelCoins**\n' +
          'Gains (après taxe de 5%) : **' + res.payout + ' BordelCoins**\n' +
          '*(Taxe serveur : ' + res.tax + ')*'
        );

      await interaction.update({ content: null, embeds: [embed], components: [] });
      return;
    }
`;

code = code.replace(/if \(customId\.startsWith\('skip_'\)\) \{/, newButtonCode + '\n    if (customId.startsWith(\'skip_\')) {');

fs.writeFileSync('discord-bot/index.js', code);
