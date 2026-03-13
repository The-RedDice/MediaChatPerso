/**
 * Cacabox Server
 * Express + Socket.io + système de file d'attente par utilisateur
 */

'use strict';

require('dotenv').config({ path: '../.env' });

const express        = require('express');
const http           = require('http');
const { Server }     = require('socket.io');
const path           = require('path');
const fs             = require('fs');
const { execFile }   = require('child_process');
const basicAuth      = require('express-basic-auth');
const multer         = require('multer');

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT      = process.env.PORT      || 3000;
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
const MEDIA_DIR  = path.resolve(process.env.MEDIA_DIR || './public/media');

// S'assurer que le dossier media existe
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

// ─── App ─────────────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 50 * 1024 * 1024, // 50 MB
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Servir les médias uploadés
app.use('/media', express.static(MEDIA_DIR));

// ─── État global ─────────────────────────────────────────────────────────────

/**
 * clients: Map<pseudo, { socketId: string, busy: boolean }>
 * queues:  Map<pseudo, Array<QueueItem>>
 *
 * QueueItem: { type: 'media'|'message'|'file', payload: object }
 */
const clients = new Map();
const queues  = new Map();

// ─── Helpers Queue ───────────────────────────────────────────────────────────

function getQueue(pseudo) {
  if (!queues.has(pseudo)) queues.set(pseudo, []);
  return queues.get(pseudo);
}

/**
 * Envoie le prochain item de la queue au client si dispo et non occupé.
 */
function flushQueue(pseudo) {
  const client = clients.get(pseudo);
  if (!client || client.busy) return;

  const queue = getQueue(pseudo);
  if (queue.length === 0) return;

  const item = queue.shift();
  client.busy = true;
  io.to(client.socketId).emit('show', item);
  console.log(`[Queue] → ${pseudo} : type=${item.type}`);
}

/**
 * Enqueue un item pour un ou plusieurs pseudos.
 * @param {string|'all'} target  pseudo ou 'all'
 * @param {object}       item    QueueItem
 */
function enqueue(target, item) {
  if (target === 'all') {
    for (const pseudo of clients.keys()) {
      getQueue(pseudo).push(item);
      flushQueue(pseudo);
    }
  } else {
    if (!clients.has(target)) {
      return { error: `Client "${target}" non connecté.` };
    }
    getQueue(target).push(item);
    flushQueue(target);
  }
  return { ok: true };
}

// ─── Socket.io ───────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  let myPseudo = null;

  // Le client s'identifie dès la connexion
  socket.on('identify', ({ pseudo }) => {
    if (!pseudo || typeof pseudo !== 'string') {
      socket.disconnect();
      return;
    }
    myPseudo = pseudo.trim().toLowerCase();

    // Si reconnexion : remplace l'ancienne socket
    clients.set(myPseudo, { socketId: socket.id, busy: false });
    if (!queues.has(myPseudo)) queues.set(myPseudo, []);

    console.log(`[+] ${myPseudo} connecté (${socket.id})`);
    socket.emit('identified', { pseudo: myPseudo });

    // Émet la liste mise à jour à tous (utile pour le panel)
    io.emit('clients_update', getClientList());

    // Flush si des items attendaient
    flushQueue(myPseudo);
  });

  // Le client signale que la lecture est terminée → flush suivant
  socket.on('media_ended', () => {
    if (!myPseudo) return;
    const client = clients.get(myPseudo);
    if (client) {
      client.busy = false;
      console.log(`[Queue] ${myPseudo} libre.`);
      flushQueue(myPseudo);
    }
  });

  socket.on('disconnect', () => {
    if (myPseudo) {
      clients.delete(myPseudo);
      console.log(`[-] ${myPseudo} déconnecté`);
      io.emit('clients_update', getClientList());
    }
  });
});

function getClientList() {
  return Array.from(clients.keys());
}

// ─── API interne (utilisée par le bot Discord ET le panel) ───────────────────

/**
 * Télécharge une URL avec yt-dlp, retourne le chemin du fichier.
 */
function downloadMedia(url) {
  return new Promise((resolve, reject) => {
    // Validation basique de l'URL
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return reject(new Error('URL invalide.'));
    }

    const filename = `media_${Date.now()}.mp4`;
    const outPath  = path.join(MEDIA_DIR, filename);

    execFile('yt-dlp', [
      '--no-playlist',
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '-o', outPath,
      '--',
      url,
    ], { timeout: 120_000 }, (err) => {
      if (err) return reject(err);
      resolve({ filename, url: `${SERVER_URL}/media/${filename}` });
    });
  });
}

// ─── Routes API REST ─────────────────────────────────────────────────────────

const router = express.Router();

// GET /api/clients — liste des connectés
router.get('/clients', (_req, res) => {
  res.json({ clients: getClientList() });
});

// POST /api/sendurl
router.post('/sendurl', async (req, res) => {
  const { url, target = 'all', caption, senderName, avatarUrl } = req.body;
  if (!url) return res.status(400).json({ error: 'url requis' });

  try {
    const media = await downloadMedia(url);
    const result = enqueue(target, {
      type: 'media',
      payload: { ...media, caption: caption || '', senderName: senderName || '', avatarUrl: avatarUrl || '' },
    });
    if (result?.error) return res.status(404).json(result);
    res.json({ ok: true, ...media });
  } catch (err) {
    console.error('[yt-dlp]', err.message);
    res.status(500).json({ error: 'Échec du téléchargement.', details: err.message });
  }
});

// POST /api/sendfile  (URL CDN Discord ou autre URL directe)
router.post('/sendfile', (req, res) => {
  const { fileUrl, target = 'all', fileType = 'image', caption, senderName, avatarUrl } = req.body;
  if (!fileUrl) return res.status(400).json({ error: 'fileUrl requis' });

  const result = enqueue(target, {
    type: 'file',
    payload: { url: fileUrl, fileType, caption: caption || '', senderName: senderName || '', avatarUrl: avatarUrl || '' },
  });
  if (result?.error) return res.status(404).json(result);
  res.json({ ok: true });
});

// POST /api/message
router.post('/message', (req, res) => {
  const { text, target = 'all', senderName, avatarUrl } = req.body;
  if (!text) return res.status(400).json({ error: 'text requis' });

  const result = enqueue(target, {
    type: 'message',
    payload: { text, senderName: senderName || '', avatarUrl: avatarUrl || '' },
  });
  if (result?.error) return res.status(404).json(result);
  res.json({ ok: true });
});

app.use('/api', router);

// ─── Panel Web ───────────────────────────────────────────────────────────────

// Auth basique pour le panel
app.use('/panel', basicAuth({
  users: { admin: process.env.PANEL_PASSWORD || 'changeme' },
  challenge: true,
}));

app.use('/panel', express.static(path.join(__dirname, 'public')));

// SPA fallback pour le panel
app.get('/panel/*path', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Démarrage ───────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n🚀 Cacabox Server démarré sur ${SERVER_URL}`);
  console.log(`📺 Panel Web : ${SERVER_URL}/panel`);
  console.log(`🔌 Socket.io prêt\n`);
});

// Exporter pour que le bot puisse accéder aux helpers
module.exports = { enqueue, getClientList, downloadMedia, io };
