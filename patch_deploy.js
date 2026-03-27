const fs = require('fs');

let code = fs.readFileSync('discord-bot/deploy-commands.js', 'utf8');

const replacement = `new SlashCommandBuilder()
    .setName('arena')
    .setDescription('Défier un joueur dans l\\'arène clandestine')
    .addSubcommand(subcommand =>
      subcommand
        .setName('challenge')
        .setDescription('Défier un autre joueur')
        .addUserOption(option =>
           option.setName('joueur')
                 .setDescription('Le joueur à défier')
                 .setRequired(true))
        .addIntegerOption(option =>
           option.setName('mise')
                 .setDescription('Mise en BordelCoins')
                 .setRequired(true)
                 .setMinValue(1))
        .addStringOption(option =>
           option.setName('objet')
                 .setDescription('Objet que vous mettez en jeu')
                 .setRequired(true)
                 .setAutocomplete(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('accept')
        .setDescription('Accepter un défi')
        .addStringOption(option =>
           option.setName('id')
                 .setDescription('ID du défi')
                 .setRequired(true))
        .addStringOption(option =>
           option.setName('objet')
                 .setDescription('Objet que vous mettez en jeu')
                 .setRequired(true)
                 .setAutocomplete(true))),

  new SlashCommandBuilder()
    .setName('coinflip')`;

code = code.replace("new SlashCommandBuilder()\n    .setName('coinflip')", replacement);
fs.writeFileSync('discord-bot/deploy-commands.js', code);
