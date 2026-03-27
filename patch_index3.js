const fs = require('fs');
let code = fs.readFileSync('discord-bot/index.js', 'utf8');

// I need to add arena to autocomplete properly
const regex1 = /interaction\.commandName === 'inventory' \|\| interaction\.commandName === 'market' \|\| interaction\.commandName === 'fish'/g;
code = code.replace(regex1, "interaction.commandName === 'inventory' || interaction.commandName === 'market' || interaction.commandName === 'fish' || interaction.commandName === 'arena'");

const regex2 = /interaction\.commandName === 'achievements' \|\| interaction\.commandName === 'craft'\)/g;
code = code.replace(regex2, "interaction.commandName === 'achievements' || interaction.commandName === 'craft' || interaction.commandName === 'arena')");

// Adding button handler for arena
const buttonHandlerRegex = /if \(customId\.startsWith\('skip_'\)\) \{/;
const buttonHandler = `if (customId.startsWith('arena_accept_') || customId.startsWith('arena_decline_')) {
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

code = code.replace(/if \(customId\.startsWith\('skip_'\)\) \{/, buttonHandler);

fs.writeFileSync('discord-bot/index.js', code);
