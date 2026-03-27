const fs = require('fs');
let code = fs.readFileSync('discord-bot/index.js', 'utf8');

// I accidentally duplicated the arena button logic and autocomplete logic. Let's fix that.

// Fix double logic in buttons
const duplicateButtonCode = `if (customId.startsWith('arena_accept_') || customId.startsWith('arena_decline_')) {
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

    if (customId.startsWith('arena_accept_') || customId.startsWith('arena_decline_')) {
      const isAccept = customId.startsWith('arena_accept_');
      const arenaId = customId.replace('arena_accept_', '').replace('arena_decline_', '');

      if (!isAccept) {
        await apiPost('/arena/cancel', { arenaId });
        await interaction.update({ content: 'Défi refusé ou annulé.', embeds: [], components: [] });
        return;
      }

      await interaction.reply({ content: \`Pour accepter le combat, tu dois choisir ton arme avec la commande : \\\`/arena accept \\\${arenaId} <ton_objet>\\\`\`, ephemeral: true });
      return;
    }`;

const singleButtonCode = `if (customId.startsWith('arena_accept_') || customId.startsWith('arena_decline_')) {
      const isAccept = customId.startsWith('arena_accept_');
      const arenaId = customId.replace('arena_accept_', '').replace('arena_decline_', '');

      if (!isAccept) {
        await apiPost('/arena/cancel', { arenaId });
        await interaction.update({ content: 'Défi refusé ou annulé.', embeds: [], components: [] });
        return;
      }

      await interaction.reply({ content: \`Pour accepter le combat, tu dois choisir ton arme avec la commande : \\\`/arena accept \\\${arenaId} <ton_objet>\\\`\`, ephemeral: true });
      return;
    }`;

code = code.replace(duplicateButtonCode, singleButtonCode);

// Fix autocomplete duplication
code = code.replace(/\|\| interaction\.commandName === 'arena' \|\| interaction\.commandName === 'arena'/g, "|| interaction.commandName === 'arena'");

fs.writeFileSync('discord-bot/index.js', code);
