const fs = require('fs');
let code = fs.readFileSync('discord-bot/index.js', 'utf8');

const deferRegex = /commandName === 'achievements' \|\| commandName === 'craft'/g;
code = code.replace(deferRegex, "commandName === 'achievements' || commandName === 'craft' || commandName === 'arena' || commandName === 'roulette'");

fs.writeFileSync('discord-bot/index.js', code);
