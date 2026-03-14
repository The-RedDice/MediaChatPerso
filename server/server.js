/**
 * BordelBox Server
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
const { getAvailableModels, generateTTS } = require('./tts');

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

// Middleware CORS pour les requêtes HTTP et Media (nécessaire pour l'API Web Audio 'crossorigin="anonymous"')
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Servir les médias uploadés
app.use('/media', express.static(MEDIA_DIR));

// ─── Proxy Audio ─────────────────────────────────────────────────────────────
// Requis pour l'API Web Audio (AudioContext) du client Tauri. Les CDN comme Discord
// peuvent bloquer l'analyse de fréquence (cors). Ce proxy fetch l'audio et
// le renvoie avec Access-Control-Allow-Origin: *
const https = require('https');
const http_mod = require('http');
app.get('/api/proxy', (req, res) => {
  const fileUrl = req.query.url;
  if (!fileUrl) return res.status(400).send('Missing url param');

  const client = fileUrl.startsWith('https') ? https : http_mod;

  client.get(fileUrl, (proxyRes) => {
    // Transmettre le content-type
    res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/octet-stream');
    proxyRes.pipe(res);
  }).on('error', (err) => {
    console.error('[Proxy Error]', err.message);
    res.status(500).send('Failed to proxy media');
  });
});

// ─── État global ─────────────────────────────────────────────────────────────

/**
 * clients: Map<pseudo, { socketId: string, busy: boolean }>
 * queues:  Map<pseudo, Array<QueueItem>>
 *
 * QueueItem: { type: 'media'|'message'|'file', payload: object }
 */
const clients = new Map();
const queues  = new Map();

// État des votes pour /voteskip
const voteSkipState = {
  active: false,
  voters: new Set(),
  requiredVotes: 0
};

// Historique des 100 derniers éléments joués/envoyés
const historyLog = [];
function addHistory(item, targetPseudo) {
  historyLog.unshift({ ...item, playedAt: Date.now(), targetPseudo });
  if (historyLog.length > 100) historyLog.pop();
}

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

  // Réinitialiser les votes s'il s'agit d'un flush global (simplifié: dès qu'un nouvel item commence)
  voteSkipState.active = false;
  voteSkipState.voters.clear();

  const item = queue.shift();
  client.busy = true;
  io.to(client.socketId).emit('show', item);
  addHistory(item, pseudo);
  console.log(`[Queue] → ${pseudo} : type=${item.type}`);
  io.emit('queue_update', getQueueDataForEmitters());
  io.emit('history_update', historyLog);
}

/**
 * Enqueue un item pour un ou plusieurs pseudos.
 * @param {string|'all'} target  pseudo ou 'all'
 * @param {object}       item    QueueItem
 */
function enqueue(target, item) {
  const enrichedItem = { ...item, enqueuedAt: Date.now() };
  if (target === 'all') {
    for (const pseudo of clients.keys()) {
      getQueue(pseudo).push(enrichedItem);
      flushQueue(pseudo);
    }
  } else {
    if (!clients.has(target)) {
      return { error: `Client "${target}" non connecté.` };
    }
    getQueue(target).push(enrichedItem);
    flushQueue(target);
  }

  io.emit('queue_update', getQueueDataForEmitters());
  return { ok: true };
}

// ─── Socket.io ───────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  let myPseudo = null;

  // Le client s'identifie dès la connexion ou change de pseudo
  socket.on('identify', ({ pseudo }) => {
    if (!pseudo || typeof pseudo !== 'string') {
      socket.disconnect();
      return;
    }
    const newPseudo = pseudo.trim().toLowerCase();

    // S'il change de pseudo sur le même socket, on supprime l'ancien
    if (myPseudo && myPseudo !== newPseudo) {
      clients.delete(myPseudo);
      console.log(`[~] ${myPseudo} a changé son pseudo en ${newPseudo}`);
    } else {
      console.log(`[+] ${newPseudo} connecté (${socket.id})`);
    }

    myPseudo = newPseudo;

    // Supprime les anciens enregistrements qui pourraient pointer vers le même socket
    for (const [p, clientData] of clients.entries()) {
      if (clientData.socketId === socket.id && p !== myPseudo) {
        clients.delete(p);
      }
    }

    // Met à jour la socket et crée la file si nécessaire
    clients.set(myPseudo, { socketId: socket.id, busy: false });
    if (!queues.has(myPseudo)) queues.set(myPseudo, []);

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
    const filename = `media_${Date.now()}.mp4`;
    const outPath  = path.join(MEDIA_DIR, filename);

    let ytDlpPath = 'yt-dlp';
    const localUnixPath = path.resolve(__dirname, '../yt-dlp');
    const localWinPath = path.resolve(__dirname, '../yt-dlp.exe');
    if (fs.existsSync(localUnixPath)) {
      ytDlpPath = localUnixPath;
    } else if (fs.existsSync(localWinPath)) {
      ytDlpPath = localWinPath;
    }

    execFile(ytDlpPath, [
      '--no-playlist',
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--extractor-args', 'youtube:player_client=android,web',
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

// ─── Helpers internes partagés (Remontés pour accessibilité) ─────────────────
function getQueueDataForEmitters() {
  const result = {};
  for (const [pseudo, q] of queues.entries()) {
    result[pseudo] = q;
  }
  return result;
}

// GET /api/tts/models — liste des modèles TTS
router.get('/tts/models', (_req, res) => {
  res.json({ models: getAvailableModels() });
});

// GET /api/queue — Récupérer toutes les queues
router.get('/queue', (_req, res) => {
  res.json(getQueueDataForEmitters());
});

// GET /api/history — Récupérer l'historique
router.get('/history', (_req, res) => {
  res.json(historyLog);
});

// DELETE /api/queue/:pseudo/:index — Supprimer un élément précis de la queue
router.delete('/queue/:pseudo/:index', (req, res) => {
  const { pseudo, index } = req.params;
  const q = queues.get(pseudo);
  if (!q) return res.status(404).json({ error: 'Queue introuvable' });

  const idx = parseInt(index, 10);
  if (isNaN(idx) || idx < 0 || idx >= q.length) {
    return res.status(400).json({ error: 'Index invalide' });
  }

  q.splice(idx, 1);
  io.emit('queue_update', getQueueDataForEmitters());
  res.json({ ok: true });
});

// POST /api/sendurl
router.post('/sendurl', async (req, res) => {
  const { url, target = 'all', caption, senderName, avatarUrl, ttsVoice, greenscreen } = req.body;
  if (!url) return res.status(400).json({ error: 'url requis' });

  let ttsUrl = '';
  if (ttsVoice && caption) {
    const ttsFilename = `tts_${Date.now()}.wav`;
    const ttsOutPath = path.join(MEDIA_DIR, ttsFilename);
    const generated = await generateTTS(caption, ttsVoice, ttsOutPath);
    if (generated) ttsUrl = `${SERVER_URL}/media/${ttsFilename}`;
  }

  // Vérifier si l'URL est un fichier direct
  const lowerUrl = url.toLowerCase();
  const isDirectImage = lowerUrl.match(/\.(jpeg|jpg|gif|png|webp|bmp|svg)(\?.*)?$/);
  const isDirectAudio = lowerUrl.match(/\.(mp3|wav|ogg|m4a|flac)(\?.*)?$/);
  const isDirectVideo = lowerUrl.match(/\.(mp4|webm|mov|avi|mkv)(\?.*)?$/);

  if (isDirectImage || isDirectAudio || isDirectVideo) {
    let fileType = 'image';
    if (isDirectAudio) fileType = 'audio';
    if (isDirectVideo) fileType = 'video';

    const result = enqueue(target, {
      type: 'file',
      payload: { url, fileType, caption: caption || '', senderName: senderName || '', avatarUrl: avatarUrl || '', ttsUrl, greenscreen: !!greenscreen },
    });
    if (result?.error) return res.status(404).json(result);
    return res.json({ ok: true, ttsUrl, directUrl: true });
  }

  try {
    const media = await downloadMedia(url);

    const result = enqueue(target, {
      type: 'media',
      payload: { ...media, caption: caption || '', senderName: senderName || '', avatarUrl: avatarUrl || '', ttsUrl, greenscreen: !!greenscreen },
    });
    if (result?.error) return res.status(404).json(result);
    res.json({ ok: true, ...media, ttsUrl });
  } catch (err) {
    console.error('[yt-dlp]', err.message);
    res.status(500).json({ error: 'Échec du téléchargement.', details: err.message });
  }
});

// POST /api/sendfile  (URL CDN Discord ou autre URL directe)
router.post('/sendfile', async (req, res) => {
  const { fileUrl, target = 'all', fileType = 'image', caption, senderName, avatarUrl, ttsVoice, greenscreen } = req.body;
  if (!fileUrl) return res.status(400).json({ error: 'fileUrl requis' });

  let ttsUrl = '';
  if (ttsVoice && caption) {
    const ttsFilename = `tts_${Date.now()}.wav`;
    const ttsOutPath = path.join(MEDIA_DIR, ttsFilename);
    const generated = await generateTTS(caption, ttsVoice, ttsOutPath);
    if (generated) ttsUrl = `${SERVER_URL}/media/${ttsFilename}`;
  }

  const result = enqueue(target, {
    type: 'file',
    payload: { url: fileUrl, fileType, caption: caption || '', senderName: senderName || '', avatarUrl: avatarUrl || '', ttsUrl, greenscreen: !!greenscreen },
  });
  if (result?.error) return res.status(404).json(result);
  res.json({ ok: true, ttsUrl });
});

// POST /api/voteskip
router.post('/voteskip', (req, res) => {
  const { voterId } = req.body;

  if (clients.size === 0) {
    return res.status(400).json({ error: 'Aucun client connecté pour skip.' });
  }

  // Activer le système de vote si c'est le premier vote pour le média en cours
  if (!voteSkipState.active) {
    voteSkipState.active = true;
    voteSkipState.voters.clear();
  }

  // L'utilisateur vote (voterId sert à éviter qu'une même personne vote 10x)
  if (voterId) {
    voteSkipState.voters.add(voterId);
  } else {
    // Fallback: incrémentation basique si pas d'ID (bien qu'il y en aura un côté discord)
    voteSkipState.voters.add(Date.now().toString());
  }

  const currentVotes = voteSkipState.voters.size;
  // La moitié doit dire oui (arrondi au supérieur: sur 5 joueurs, il faut 3 votes)
  const requiredVotes = Math.ceil(clients.size / 2);

  if (currentVotes >= requiredVotes) {
    // Déclenchement du SKIP !
    console.log(`[VoteSkip] Seuil atteint (${currentVotes}/${requiredVotes}). Skiping current media...`);
    io.emit('force_skip');

    // On réinitialise l'état
    voteSkipState.active = false;
    voteSkipState.voters.clear();

    // Le 'force_skip' côté client va déclencher 'media_ended' qui fera avancer la file
    return res.json({ skipped: true, currentVotes, requiredVotes });
  }

  res.json({ skipped: false, currentVotes, requiredVotes });
});

// POST /api/message
router.post('/message', async (req, res) => {
  const { text, target = 'all', senderName, avatarUrl, ttsVoice, greenscreen } = req.body;
  if (!text) return res.status(400).json({ error: 'text requis' });

  let ttsUrl = '';
  if (ttsVoice && text) {
    const ttsFilename = `tts_${Date.now()}.wav`;
    const ttsOutPath = path.join(MEDIA_DIR, ttsFilename);
    const generated = await generateTTS(text, ttsVoice, ttsOutPath);
    if (generated) ttsUrl = `${SERVER_URL}/media/${ttsFilename}`;
  }

  const result = enqueue(target, {
    type: 'message',
    payload: { text, senderName: senderName || '', avatarUrl: avatarUrl || '', ttsUrl, greenscreen: !!greenscreen },
  });
  if (result?.error) return res.status(404).json(result);
  res.json({ ok: true, ttsUrl });
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
  console.log(`\n🚀 BordelBox Server démarré sur ${SERVER_URL}`);
  console.log(`📺 Panel Web : ${SERVER_URL}/panel`);
  console.log(`🔌 Socket.io prêt\n`);
});

// Exporter pour que le bot puisse accéder aux helpers
module.exports = { enqueue, getClientList, downloadMedia, io };
