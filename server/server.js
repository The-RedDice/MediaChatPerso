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
const session        = require('express-session');
const passport       = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { getAvailableModels, generateTTS } = require('./tts');
const { recordAction, getUserStats, getLeaderboard, getUserProfile, saveUserProfile } = require('./stats');

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT      = process.env.PORT      || 3000;
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
const MEDIA_DIR  = path.resolve(process.env.MEDIA_DIR || './public/media');

// S'assurer que le dossier media existe
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

// ─── Nettoyage Auto ──────────────────────────────────────────────────────────

function cleanupOldMedia() {
  const maxAgeMs = 24 * 60 * 60 * 1000; // 24 heures
  const now = Date.now();

  fs.readdir(MEDIA_DIR, (err, files) => {
    if (err) {
      console.error('[Cleanup Error]', err);
      return;
    }

    files.forEach((file) => {
      const filePath = path.join(MEDIA_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;

        // On ne supprime que les fichiers
        if (stats.isFile() && (now - stats.mtimeMs > maxAgeMs)) {
          fs.unlink(filePath, (err) => {
            if (err) console.error(`[Cleanup Error] Impossible de supprimer ${file}:`, err);
            else console.log(`[Cleanup] Supprimé ${file} (vieux de > 24h)`);
          });
        }
      });
    });
  });
}

// Nettoyage au démarrage puis toutes les heures
cleanupOldMedia();
setInterval(cleanupOldMedia, 60 * 60 * 1000);

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

// Trust proxy pour les cookies sécurisés derrière un reverse proxy (ex: Nginx/Cloudflare)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Configuration Session et Passport pour Discord
app.use(session({
  secret: process.env.SESSION_SECRET || 'changeme',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 1 semaine
  }
}));

app.use(passport.initialize());
app.use(passport.session());

if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
  passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_REDIRECT_URI || `${SERVER_URL}/auth/discord/callback`,
    scope: ['identify', 'guilds']
  }, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
  }));

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((obj, done) => done(null, obj));
}

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
      '--max-filesize', '250M',
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
app.get('/api/clients', (_req, res) => {
  res.json({ clients: getClientList() });
});

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

// DELETE /api/queue/:pseudo — Vider entièrement la file d'un joueur
router.delete('/queue/:pseudo', (req, res) => {
  const { pseudo } = req.params;
  const q = queues.get(pseudo);
  if (!q) return res.status(404).json({ error: 'Queue introuvable' });

  // Vider le tableau tout en gardant la même référence mémoire
  q.length = 0;

  io.emit('queue_update', getQueueDataForEmitters());
  res.json({ ok: true, msg: `File de ${pseudo} vidée.` });
});

// ─── Authentification Discord & Upload public ────────────────────────────────

// Redirection vers Discord
app.get('/auth/discord', passport.authenticate('discord'));

// Retour de Discord
app.get('/auth/discord/callback', passport.authenticate('discord', {
  failureRedirect: '/upload?error=auth_failed'
}), (req, res) => {
  // Vérifie que l'utilisateur est dans la guild
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) {
    return res.redirect('/upload'); // pas de vérification de serveur si non défini
  }

  const inGuild = req.user.guilds.some(g => g.id === guildId);
  if (!inGuild) {
    req.logout((err) => {
      res.redirect('/upload?error=not_in_guild');
    });
    return;
  }

  res.redirect('/upload');
});

// Statut d'authentification pour le front
app.get('/auth/status', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ authenticated: true, user: { username: req.user.username, id: req.user.id, avatar: `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png` } });
  } else {
    res.json({ authenticated: false });
  }
});

app.post('/auth/logout', (req, res) => {
  req.logout((err) => {
    res.json({ ok: true });
  });
});

// Stockage Multer pour l'upload local (page d'upload)
const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MEDIA_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `upload_${Date.now()}_${Math.round(Math.random() * 1E9)}${ext}`);
  }
});

const uploadMiddleware = multer({
  storage: uploadStorage,
  limits: { fileSize: 250 * 1024 * 1024 } // 250MB limit
});

// Helper: Vérification auth pour les middlewares
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Non authentifié via Discord.' });
}

// L'endpoint qui reçoit le fichier de la page upload (l'auth DOIT se faire avant multer)
app.post('/api/upload', requireAuth, uploadMiddleware.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'Aucun fichier uploadé.' });
  }

  const { target = 'all', caption, ttsVoice, greenscreen } = req.body;

  const senderName = req.user.displayName || req.user.username;
  const avatarUrl = `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png`;
  const userId = req.user.id;

  // Utiliser le profil utilisateur sauvegardé
  const profile = getUserProfile(userId) || {};
  const style = { color: profile.color, font: profile.font, animation: profile.animation, effect: profile.effect };

  let ttsUrl = '';
  if (ttsVoice && caption) {
    const ttsFilename = `tts_${Date.now()}.wav`;
    const ttsOutPath = path.join(MEDIA_DIR, ttsFilename);
    const generated = await generateTTS(caption, ttsVoice, ttsOutPath);
    if (generated) ttsUrl = `${SERVER_URL}/media/${ttsFilename}`;
  }

  let fileType = 'image';
  if (file.mimetype.startsWith('audio/')) fileType = 'audio';
  else if (file.mimetype.startsWith('video/')) fileType = 'video';

  const fileUrl = `${SERVER_URL}/media/${file.filename}`;

  const result = enqueue(target, {
    type: 'file',
    payload: { url: fileUrl, fileType, caption: caption || '', senderName, avatarUrl, ttsUrl, greenscreen: greenscreen === 'true', style },
  });

  if (result?.error) return res.status(404).json(result);

  recordAction(userId, senderName, 'file');
  io.emit('panel_log', { msg: `${senderName} a uploadé un fichier (${fileType}) depuis le web → ${target}`, type: 'ok' });
  res.json({ ok: true, fileUrl, ttsUrl });
});


// ─── API Stats ───────────────────────────────────────────────────────────────

router.get('/stats/:userId', (req, res) => {
  const data = getUserStats(req.params.userId);
  if (!data) return res.json({ error: 'Aucune donnée pour cet utilisateur' });
  res.json(data);
});

router.get('/leaderboard', (req, res) => {
  res.json(getLeaderboard());
});

router.get('/style/:userId', (req, res) => {
  const data = getUserProfile(req.params.userId);
  if (!data) return res.json({ profile: {} });
  res.json({ profile: data });
});

router.post('/style/:userId', (req, res) => {
  const { username, color, font, animation, effect } = req.body;
  if (!username) return res.status(400).json({ error: 'username requis' });

  const currentProfile = getUserProfile(req.params.userId) || {};
  const newProfile = {
    color: color !== undefined ? color : currentProfile.color,
    font: font !== undefined ? font : currentProfile.font,
    animation: animation !== undefined ? animation : currentProfile.animation,
    effect: effect !== undefined ? effect : currentProfile.effect,
  };

  saveUserProfile(req.params.userId, username, newProfile);
  res.json({ ok: true, profile: newProfile });
});

// POST /api/sendurl
router.post('/sendurl', async (req, res) => {
  const { url, target = 'all', caption, senderName, avatarUrl, ttsVoice, greenscreen, userId, color, font, animation, effect } = req.body;
  if (!url) return res.status(400).json({ error: 'url requis' });

  let ttsUrl = '';
  if (ttsVoice && caption) {
    const ttsFilename = `tts_${Date.now()}.wav`;
    const ttsOutPath = path.join(MEDIA_DIR, ttsFilename);
    const generated = await generateTTS(caption, ttsVoice, ttsOutPath);
    if (generated) ttsUrl = `${SERVER_URL}/media/${ttsFilename}`;
  }

  // Vérifier la taille et le type via une requête HEAD
  let isDirectFile = false;
  let fileType = 'image';

  try {
    const headRes = await fetch(url, { method: 'HEAD' });
    if (headRes.ok) {
      const contentLength = headRes.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > 250 * 1024 * 1024) {
        return res.status(413).json({ error: 'Le fichier dépasse la limite de 250 Mo.' });
      }

      const contentType = headRes.headers.get('content-type') || '';
      if (contentType.startsWith('image/')) {
        isDirectFile = true;
        fileType = 'image';
      } else if (contentType.startsWith('audio/')) {
        isDirectFile = true;
        fileType = 'audio';
      } else if (contentType.startsWith('video/')) {
        isDirectFile = true;
        fileType = 'video';
      }
    }
  } catch (err) {
    // Ignorer l'erreur HEAD
  }

  // Fallback sur l'extension si le HEAD n'a pas pu déterminer le type (ex: application/octet-stream ou erreur réseau)
  if (!isDirectFile) {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.match(/\.(jpeg|jpg|gif|png|webp|bmp|svg)(\?.*)?$/)) {
      isDirectFile = true;
      fileType = 'image';
    } else if (lowerUrl.match(/\.(mp3|wav|ogg|m4a|flac)(\?.*)?$/)) {
      isDirectFile = true;
      fileType = 'audio';
    } else if (lowerUrl.match(/\.(mp4|webm|mov|avi|mkv)(\?.*)?$/)) {
      isDirectFile = true;
      fileType = 'video';
    }
  }

  const payloadStyle = { color, font, animation, effect };

  if (isDirectFile) {
    const result = enqueue(target, {
      type: 'file',
      payload: { url, fileType, caption: caption || '', senderName: senderName || '', avatarUrl: avatarUrl || '', ttsUrl, greenscreen: !!greenscreen, style: payloadStyle },
    });
    if (result?.error) return res.status(404).json(result);
    if (userId) recordAction(userId, senderName, 'file');
    io.emit('panel_log', { msg: `${senderName || 'Discord'} a envoyé un lien direct (${fileType}) → ${target}`, type: 'ok' });
    return res.json({ ok: true, ttsUrl, directUrl: true });
  }

  try {
    const media = await downloadMedia(url);

    const result = enqueue(target, {
      type: 'media',
      payload: { ...media, caption: caption || '', senderName: senderName || '', avatarUrl: avatarUrl || '', ttsUrl, greenscreen: !!greenscreen, style: payloadStyle },
    });
    if (result?.error) return res.status(404).json(result);
    if (userId) recordAction(userId, senderName, 'media');
    io.emit('panel_log', { msg: `${senderName || 'Discord'} a envoyé un lien via yt-dlp → ${target}`, type: 'ok' });
    res.json({ ok: true, ...media, ttsUrl });
  } catch (err) {
    console.error('[yt-dlp]', err.message);
    io.emit('panel_log', { msg: `Erreur yt-dlp pour l'URL ${url}: ${err.message}`, type: 'err' });
    res.status(500).json({ error: 'Échec du téléchargement.', details: err.message });
  }
});

// POST /api/sendfile  (URL CDN Discord ou autre URL directe)
router.post('/sendfile', async (req, res) => {
  const { fileUrl, target = 'all', fileType = 'image', caption, senderName, avatarUrl, ttsVoice, greenscreen, userId, color, font, animation, effect } = req.body;
  if (!fileUrl) return res.status(400).json({ error: 'fileUrl requis' });

  try {
    const headRes = await fetch(fileUrl, { method: 'HEAD' });
    if (headRes.ok) {
      const contentLength = headRes.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > 250 * 1024 * 1024) {
        return res.status(413).json({ error: 'Le fichier dépasse la limite de 250 Mo.' });
      }
    }
  } catch (err) {
    // Si la requête HEAD échoue, on continue quand même.
  }

  let ttsUrl = '';
  if (ttsVoice && caption) {
    const ttsFilename = `tts_${Date.now()}.wav`;
    const ttsOutPath = path.join(MEDIA_DIR, ttsFilename);
    const generated = await generateTTS(caption, ttsVoice, ttsOutPath);
    if (generated) ttsUrl = `${SERVER_URL}/media/${ttsFilename}`;
  }

  const payloadStyle = { color, font, animation, effect };

  const result = enqueue(target, {
    type: 'file',
    payload: { url: fileUrl, fileType, caption: caption || '', senderName: senderName || '', avatarUrl: avatarUrl || '', ttsUrl, greenscreen: !!greenscreen, style: payloadStyle },
  });
  if (result?.error) return res.status(404).json(result);
  if (userId) recordAction(userId, senderName, 'file');
  io.emit('panel_log', { msg: `${senderName || 'Discord'} a envoyé un fichier (${fileType}) → ${target}`, type: 'ok' });
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
    io.emit('panel_log', { msg: `VoteSkip validé ! (${currentVotes}/${requiredVotes}) Media passé.`, type: 'ok' });

    // On réinitialise l'état
    voteSkipState.active = false;
    voteSkipState.voters.clear();

    // Le 'force_skip' côté client va déclencher 'media_ended' qui fera avancer la file
    return res.json({ skipped: true, currentVotes, requiredVotes });
  }

  // Émettre l'état des votes à tous les clients
  io.emit('voteskip_update', { currentVotes, requiredVotes });
  io.emit('panel_log', { msg: `VoteSkip en cours... (${currentVotes}/${requiredVotes})`, type: 'info' });

  res.json({ skipped: false, currentVotes, requiredVotes });
});

// POST /api/message
router.post('/message', async (req, res) => {
  const { text, target = 'all', senderName, avatarUrl, ttsVoice, greenscreen, userId, color, font, animation, effect } = req.body;
  if (!text) return res.status(400).json({ error: 'text requis' });

  let ttsUrl = '';
  if (ttsVoice && text) {
    const ttsFilename = `tts_${Date.now()}.wav`;
    const ttsOutPath = path.join(MEDIA_DIR, ttsFilename);
    const generated = await generateTTS(text, ttsVoice, ttsOutPath);
    if (generated) ttsUrl = `${SERVER_URL}/media/${ttsFilename}`;
  }

  const payloadStyle = { color, font, animation, effect };

  const result = enqueue(target, {
    type: 'message',
    payload: { text, senderName: senderName || '', avatarUrl: avatarUrl || '', ttsUrl, greenscreen: !!greenscreen, style: payloadStyle },
  });
  if (result?.error) return res.status(404).json(result);
  if (userId) recordAction(userId, senderName, 'message');
  io.emit('panel_log', { msg: `${senderName || 'Discord'} a envoyé un message texte → ${target}`, type: 'ok' });
  res.json({ ok: true, ttsUrl });
});

app.use('/api', router);

// ─── Fichiers Statiques Publics ──────────────────────────────────────────────
// Les assets communs (css/js/images) doivent être accessibles sans auth
app.use('/panel/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/panel/js', express.static(path.join(__dirname, 'public', 'js')));

// Route publique pour la page d'upload
app.use('/upload', express.static(path.join(__dirname, 'public', 'upload')));
app.get('/upload/*path', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload', 'index.html'));
});

// ─── Panel Web ───────────────────────────────────────────────────────────────

// Auth basique pour le panel
app.use('/panel', basicAuth({
  users: { admin: process.env.PANEL_PASSWORD || 'changeme' },
  challenge: true,
}));

// Route statique pour servir index.html du panel
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
