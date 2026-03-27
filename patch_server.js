const fs = require('fs');

let code = fs.readFileSync('server/server.js', 'utf8');

const importRegex = /createCoinflip, acceptCoinflip, cancelCoinflip, craftItem \} = require\('\.\/stats'\);/;
code = code.replace(importRegex, "createCoinflip, acceptCoinflip, cancelCoinflip, craftItem, createArenaChallenge, acceptArenaChallenge, cancelArenaChallenge } = require('./stats');");

const replacement = `// ─── ARENA ─────────────────────────────────────────────────────────
router.post('/arena/create', requireAuth, (req, res) => {
  const { userId, targetId, amount, userItemId } = req.body;
  if (!userId || !targetId || amount === undefined || !userItemId) return res.status(400).json({ error: 'Paramètres manquants' });
  const result = createArenaChallenge(userId, targetId, parseInt(amount, 10), userItemId);
  res.json(result);
});

router.post('/arena/accept', requireAuth, (req, res) => {
  const { arenaId, userId, targetItemId } = req.body;
  if (!arenaId || !userId || !targetItemId) return res.status(400).json({ error: 'Paramètres manquants' });
  const result = acceptArenaChallenge(arenaId, userId, targetItemId);
  res.json(result);
});

router.post('/arena/cancel', requireAuth, (req, res) => {
  const { arenaId } = req.body;
  if (!arenaId) return res.status(400).json({ error: 'Paramètres manquants' });
  cancelArenaChallenge(arenaId);
  res.json({ ok: true });
});

router.get('/market', (req, res) => {`;

code = code.replace("router.get('/market', (req, res) => {", replacement);
fs.writeFileSync('server/server.js', code);
