const fs = require('fs');

let code = fs.readFileSync('discord-bot/deploy-commands.js', 'utf8');

const rouletteCommand = `new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Lancer une partie de Roulette Russe avec d\\'autres joueurs (Taxe de 5%)')
    .addIntegerOption(option =>
       option.setName('mise')
             .setDescription('La mise en BordelCoins')
             .setRequired(true)
             .setMinValue(1)),

  new SlashCommandBuilder()
    .setName('arena')`;

code = code.replace("new SlashCommandBuilder()\n    .setName('arena')", rouletteCommand);

fs.writeFileSync('discord-bot/deploy-commands.js', code);
