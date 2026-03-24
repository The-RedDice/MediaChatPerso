const fs = require('fs');
let code = fs.readFileSync('server/server.js', 'utf8');

const newRoutesCode = `
// ─── COLLECTION & ACHIEVEMENTS ─────────────────────────────────────
router.get('/collection', requireAuth, (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId manquant' });
  const result = stats.getCollectionProgress(userId);
  res.json(result);
});

router.get('/achievements', requireAuth, (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId manquant' });

  const inv = stats.getInventory(userId).items;
  const itemsDb = stats.getItemsDb();

  const unlocked = [];
  for (const itemId in inv) {
     if (inv[itemId] > 0) {
        let isUntradeable = false;
        let itemInfo = null;
        for (const cat in itemsDb) {
           if (itemsDb[cat][itemId]) {
              if (itemsDb[cat][itemId].untradeable) {
                 isUntradeable = true;
                 itemInfo = itemsDb[cat][itemId];
                 break;
              }
           }
        }
        if (isUntradeable && (itemId.startsWith('T_') || itemId.startsWith('B_'))) {
           unlocked.push({ name: itemInfo.name, emoji: itemInfo.emoji });
        }
     }
  }

  res.json({ ok: true, achievements: unlocked });
});

// ─── DAILY REWARDS ─────────────────────────────────────────────────
router.post('/daily', requireAuth, (req, res) => {
  const userId = req.body.userId;
  if (!userId) return res.status(400).json({ error: 'userId manquant' });
  const result = stats.claimDaily(userId);
  res.json(result);
});

// ─── FISHING ───────────────────────────────────────────────────────
router.post('/fish', requireAuth, (req, res) => {
  const { userId, bait } = req.body;
  if (!userId || !bait) return res.status(400).json({ error: 'Paramètres manquants' });

  const inv = stats.getInventory(userId);
  let rodId = 'R_WOOD'; // fallback
  for (const r of ['R_DIAMOND', 'R_GOLD', 'R_IRON', 'R_WOOD']) {
     if (inv.items[r] && inv.items[r] > 0) {
        rodId = r; break;
     }
  }

  const result = stats.fish(userId, bait, rodId);
  res.json(result);
});

// ─── SLOTS ─────────────────────────────────────────────────────────
router.post('/slots', requireAuth, (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount) return res.status(400).json({ error: 'Paramètres manquants' });
  const result = stats.playSlots(userId, parseInt(amount, 10));
  res.json(result);
});

// ─── COINFLIP ──────────────────────────────────────────────────────
router.post('/coinflip/create', requireAuth, (req, res) => {
  const { userId, targetId, amount } = req.body;
  if (!userId || !targetId || !amount) return res.status(400).json({ error: 'Paramètres manquants' });
  const result = stats.createCoinflip(userId, targetId, parseInt(amount, 10));
  res.json(result);
});

router.post('/coinflip/accept', requireAuth, (req, res) => {
  const { flipId, userId } = req.body;
  if (!flipId || !userId) return res.status(400).json({ error: 'Paramètres manquants' });
  const result = stats.acceptCoinflip(flipId, userId);
  res.json(result);
});

router.post('/coinflip/cancel', requireAuth, (req, res) => {
  const { flipId } = req.body;
  if (!flipId) return res.status(400).json({ error: 'Paramètres manquants' });
  stats.cancelCoinflip(flipId);
  res.json({ ok: true });
});

`;

code = code.replace(/router\.get\('\/market', \(req, res\) => \{/, newRoutesCode + '\nrouter.get(\'/market\', (req, res) => {');

fs.writeFileSync('server/server.js', code);
