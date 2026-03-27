const fs = require('fs');
let code = fs.readFileSync('server/server.js', 'utf8');

const importRegex = /createRoulette, joinRoulette, startRoulette, shootRoulette, voteDrawRoulette, cancelRoulette } = require\('\.\/stats'\);/;
code = code.replace(importRegex, "createRoulette, joinRoulette, startRoulette, shootRoulette, voteDrawRoulette, cancelRoulette, getRouletteState } = require('./stats');");

const shootEndpoint = `router.post('/roulette/shoot', requireAuth, (req, res) => {
  const { rouletteId, shooterId, targetId } = req.body;
  if (!rouletteId || !shooterId || !targetId) return res.status(400).json({ error: 'Paramètres manquants' });
  const result = shootRoulette(rouletteId, shooterId, targetId);
  res.json(result);
});`;

code = code.replace(/router\.post\('\/roulette\/shoot', requireAuth, \(req, res\) => \{[\s\S]*?\}\);/, shootEndpoint);

const stateEndpoint = `router.get('/roulette/state', requireAuth, (req, res) => {
  const { rouletteId } = req.query;
  if (!rouletteId) return res.status(400).json({ error: 'Paramètres manquants' });
  const result = getRouletteState(rouletteId);
  res.json(result);
});

// ─── ARENA ─────────────────────────────────────────────────────────`;

code = code.replace("// ─── ARENA ─────────────────────────────────────────────────────────", stateEndpoint);

fs.writeFileSync('server/server.js', code);
