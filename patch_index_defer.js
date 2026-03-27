const fs = require('fs');

let code = fs.readFileSync('discord-bot/index.js', 'utf8');

// Update deferReply for roulette
const deferRegex = /interaction\.commandName === 'arena'\)/g;
code = code.replace(deferRegex, "interaction.commandName === 'arena' || interaction.commandName === 'roulette')");

fs.writeFileSync('discord-bot/index.js', code);
