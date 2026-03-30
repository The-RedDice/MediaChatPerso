const fs = require('fs');
let code = fs.readFileSync('discord-bot/index.js', 'utf8');

const tutoReplacement = `value: '\`/daily\` : Récompense quotidienne\\n\`/fish\` : Pêche des poissons avec des appâts.\\n\`/slots\` : Machine à sous.\\n\`/arena\` : Combat 1v1 d\\'objets.\\n\`/roulette\` : Buckshot Roulette.\\n\`/coinflip\` : Pari contre un autre joueur.\\n\`/achievements\` : Voir vos succès.'`;
code = code.replace(/value: '`\/daily` : Récompense quotidienne\\n`\/fish` : Pêche des poissons avec des appâts\.\\n`\/slots` : Machine à sous\.\\n`\/coinflip` : Pari contre un autre joueur\.\\n`\/achievements` : Voir vos succès\.'/g, tutoReplacement);

const infoReplacement = `embed.setTitle('💰 Économie & BordelCoins')
                 .setDescription('Les **BordelCoins** sont la monnaie de la BordelBox.\\n\\n**Comment en gagner ?**\\n- Les upvotes dans le salon réputation 👍\\n- La commande \`/daily\` tous les jours\\n- Vaincre un \`/event boss\` (nécessite l\\'overlay ouvert)\\n- La pêche (\`/fish\`), machine à sous (\`/slots\`), paris (\`/coinflip\`), \`/arena\` et \`/roulette\`\\n- Vendre vos objets sur le \`/market\`\\n\\n**Que faire avec ?**\\n- Acheter des effets visuels dans le \`/shop\`\\n- Acheter des lootboxes (\`/lootbox buy\`)\\n- Acheter de meilleurs appâts pour \`/fish\` ou des cannes à pêche (\`/craft\`)');`;
code = code.replace(/embed\.setTitle\('💰 Économie & BordelCoins'\)[\s\S]*?break;/g, infoReplacement + "\n            break;");

fs.writeFileSync('discord-bot/index.js', code);
