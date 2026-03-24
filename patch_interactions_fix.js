const fs = require('fs');
let code = fs.readFileSync('discord-bot/index.js', 'utf8');

// Use simple split-join to replace the bad block
const lines = code.split('\n');
const startIdx = lines.findIndex(l => l.includes("'<@' + res.winner + '> gagne contre <@' + res.loser + '> !"));
if (startIdx !== -1) {
  let endIdx = startIdx;
  while (!lines[endIdx].includes("*(Taxe serveur : ' + res.tax + ')*'")) {
    endIdx++;
  }
  const replacement = "          `<@${res.winner}> gagne contre <@${res.loser}> !\\n\\n` +\n" +
                      "          `Mise : **${res.amount} BordelCoins**\\n` +\n" +
                      "          `Gains (après taxe de 5%) : **${res.payout} BordelCoins**\\n` +\n" +
                      "          `*(Taxe serveur : ${res.tax})*`";

  lines.splice(startIdx, endIdx - startIdx + 1, replacement);
  fs.writeFileSync('discord-bot/index.js', lines.join('\n'));
} else {
  console.log("Not found.");
}
