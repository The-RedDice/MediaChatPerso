const fs = require('fs');
let code = fs.readFileSync('server/server.js', 'utf8');

const importRegex = /createArenaChallenge, acceptArenaChallenge, cancelArenaChallenge } = require\('\.\/stats'\);/;
code = code.replace(importRegex, "createArenaChallenge, acceptArenaChallenge, cancelArenaChallenge, createRoulette, joinRoulette, startRoulette, shootRoulette, voteDrawRoulette, cancelRoulette } = require('./stats');");

const rouletteEndpoints = `// ─── ROULETTE ──────────────────────────────────────────────────────
router.post('/roulette/create', requireAuth, (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || amount === undefined) return res.status(400).json({ error: 'Paramètres manquants' });
  const result = createRoulette(userId, parseInt(amount, 10));
  res.json(result);
});

router.post('/roulette/join', requireAuth, (req, res) => {
  const { rouletteId, userId } = req.body;
  if (!rouletteId || !userId) return res.status(400).json({ error: 'Paramètres manquants' });
  const result = joinRoulette(rouletteId, userId);
  res.json(result);
});

router.post('/roulette/start', requireAuth, (req, res) => {
  const { rouletteId } = req.body;
  if (!rouletteId) return res.status(400).json({ error: 'Paramètres manquants' });
  const result = startRoulette(rouletteId);
  res.json(result);
});

router.post('/roulette/shoot', requireAuth, (req, res) => {
  const { rouletteId } = req.body;
  if (!rouletteId) return res.status(400).json({ error: 'Paramètres manquants' });
  const result = shootRoulette(rouletteId);
  res.json(result);
});

router.post('/roulette/vote', requireAuth, (req, res) => {
  const { rouletteId, userId, vote } = req.body;
  if (!rouletteId || !userId || vote === undefined) return res.status(400).json({ error: 'Paramètres manquants' });
  const result = voteDrawRoulette(rouletteId, userId, vote);
  res.json(result);
});

router.post('/roulette/cancel', requireAuth, (req, res) => {
  const { rouletteId } = req.body;
  if (!rouletteId) return res.status(400).json({ error: 'Paramètres manquants' });
  cancelRoulette(rouletteId);
  res.json({ ok: true });
});

// ─── ARENA ─────────────────────────────────────────────────────────`;

code = code.replace("// ─── ARENA ─────────────────────────────────────────────────────────", rouletteEndpoints);
fs.writeFileSync('server/server.js', code);
