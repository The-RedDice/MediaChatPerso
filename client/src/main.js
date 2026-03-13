/**
 * Cacabox Client — main.js
 * Socket.io + affichage + mute/disable + config dynamique + raccourcis
 */

// ─── Config par défaut ────────────────────────────────────────────────────────

let CONFIG = {
  pseudo:    'unknown',
  serverUrl: 'http://localhost:3000',
  textSize:  8,    // vw
  mediaSize: 80,   // % écran
  muted:     false,
  shortcut:  'Ctrl+Shift+D',
};

let overlayEnabled = true;
let socket;

// ─── Éléments DOM ─────────────────────────────────────────────────────────────

const mediaContainer  = document.getElementById('media-container');
const mediaVideo      = document.getElementById('media-video');
const mediaImage      = document.getElementById('media-image');
const mediaCaption    = document.getElementById('media-caption');
const senderInfo      = document.getElementById('sender-info');
const senderAvatar    = document.getElementById('sender-avatar');
const senderName      = document.getElementById('sender-name');
const messageContainer = document.getElementById('message-container');
const messageText     = document.getElementById('message-text');
const audioPlayer     = document.getElementById('audio-player');
const muteBadge       = document.getElementById('mute-badge');

// ─── Application de la config ─────────────────────────────────────────────────

function applyConfig(cfg) {
  if (typeof cfg === 'string') cfg = JSON.parse(cfg);
  CONFIG = { ...CONFIG, ...cfg };

  // Variables CSS pour les tailles
  document.documentElement.style.setProperty('--text-size',  `${CONFIG.textSize}vw`);
  document.documentElement.style.setProperty('--media-size', CONFIG.mediaSize);

  // Application des positions
  const px = (CONFIG.posX !== undefined) ? CONFIG.posX : 50;
  const py = (CONFIG.posY !== undefined) ? CONFIG.posY : 50;

  // Conversion 0-100 en flex/margin ou translate. Le plus simple est le padding ou l'alignement flex, mais transform: translate est plus propre
  document.documentElement.style.setProperty('--pos-x', `${px}%`);
  document.documentElement.style.setProperty('--pos-y', `${py}%`);

  // Badge mute
  muteBadge.classList.toggle('visible', !!CONFIG.muted);
}

function updateOverlayBadge() {
  const badge = document.getElementById('overlay-badge');
  if (badge) {
    if (!overlayEnabled) {
      badge.classList.add('visible');
      badge.textContent = '👁 OVERLAY OFF';
    } else {
      badge.classList.remove('visible');
    }
  }
}

// ─── Chargement config (Tauri ou fetch fallback) ──────────────────────────────

async function loadConfig() {
  try {
    const raw = await window.__TAURI__.core.invoke('load_config');
    applyConfig(raw);
  } catch {
    // Fallback navigateur (mode dev)
    try {
      const res = await fetch('./config.json');
      applyConfig(await res.json());
    } catch {}
  }
}

// ─── Chargement Socket.io ────────────────────────────────────────────────────

async function loadSocketIO() {
  return new Promise((resolve, reject) => {
    const s   = document.createElement('script');
    s.src     = `${CONFIG.serverUrl}/socket.io/socket.io.js`;
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ─── Affichage ────────────────────────────────────────────────────────────────

function showItem(item) {
  // Overlay désactivé → skip immédiat
  if (!overlayEnabled) {
    socket.emit('media_ended');
    return;
  }

  const { type, payload } = item;

  // On nettoie l'écran des éléments précédents, sauf si un audio TTS est déjà en route et qu'on le garde
  if (!payload.ttsUrl || CONFIG.muted) {
    hideAll();
  } else {
    // Si on a du TTS, on ne veut pas couper l'audioPlayer qui va suivre, mais on doit quand même
    // cacher l'image/vidéo/texte précédent.
    mediaContainer.classList.remove('visible');
    messageContainer.classList.remove('visible');
    senderInfo.classList.remove('visible');
    mediaCaption.classList.remove('visible');
    mediaCaption.textContent = '';
    mediaVideo.src = ''; mediaVideo.pause();
    mediaImage.src = '';
  }

  // Afficher l'expéditeur Discord si présent
  if (payload.senderName) {
    senderName.textContent  = payload.senderName;
    senderAvatar.src        = payload.avatarUrl || '';
    senderAvatar.style.display = payload.avatarUrl ? 'block' : 'none';
    senderInfo.classList.add('visible');
  } else {
    senderInfo.classList.remove('visible');
  }

  // Si un son TTS est fourni, on le met en route via audioPlayer (seulement si non mute)
  if (payload.ttsUrl && !CONFIG.muted) {
    audioPlayer.src = payload.ttsUrl;
    audioPlayer.play().catch(() => {});
  }

  switch (type) {

    case 'media': {
      senderInfo.style.marginTop = '';
      senderInfo.style.marginLeft = '';

      const src = `${CONFIG.serverUrl}/media/${payload.filename}`;
      mediaVideo.style.display = 'block';
      mediaImage.style.display = 'none';
      mediaVideo.src    = src;
      mediaVideo.muted  = !!CONFIG.muted;
      mediaVideo.volume = 1;
      mediaContainer.classList.add('visible');

      // Si TTS est joué, baisser le volume de la vidéo
      if (payload.ttsUrl && !CONFIG.muted) {
        mediaVideo.volume = 0.2;
      }

      // Caption optionnelle
      if (payload.caption) {
        mediaCaption.textContent = payload.caption;
        mediaCaption.classList.add('visible');
      }

      mediaVideo.onended = () => { hideAll(); socket.emit('media_ended'); };
      mediaVideo.onerror = () => { hideAll(); socket.emit('media_ended'); };
      break;
    }

    case 'file': {
      senderInfo.style.marginTop = '';
      senderInfo.style.marginLeft = '';

      const { url, fileType } = payload;

      if (fileType === 'audio') {
        if (CONFIG.muted) { socket.emit('media_ended'); return; }
        audioPlayer.src = url;
        audioPlayer.play().catch(() => {});
        audioPlayer.onended = () => socket.emit('media_ended');
      } else {
        mediaImage.style.display = 'block';
        mediaVideo.style.display = 'none';
        mediaImage.src = url;
        mediaContainer.classList.add('visible');

        if (payload.caption) {
          mediaCaption.textContent = payload.caption;
          mediaCaption.classList.add('visible');
        }

        let waitTime = 5000;
        let endedEmitted = false;

        const endFile = () => {
          if (endedEmitted) return;
          endedEmitted = true;
          hideAll();
          socket.emit('media_ended');
        };

        if (payload.ttsUrl && !CONFIG.muted) {
          audioPlayer.onended = endFile;
          // Timeout de secours au cas où l'audio bug
          setTimeout(endFile, 30000);
        } else {
          setTimeout(endFile, waitTime);
        }
      }
      break;
    }

    case 'message': {
      messageText.textContent = payload.text;
      messageText.style.animation = 'none';
      messageText.offsetHeight;
      messageText.style.animation = '';
      messageContainer.classList.add('visible');

      // Pour un texte pur, le sender info se place un peu différemment
      senderInfo.style.marginTop = '-100px';
      senderInfo.style.marginLeft = '0px';

      let duration = Math.min(8000, Math.max(3000, payload.text.length * 60));
      let endedEmitted = false;

      const endMsg = () => {
        if (endedEmitted) return;
        endedEmitted = true;
        messageContainer.classList.remove('visible');
        senderInfo.classList.remove('visible');
        setTimeout(() => socket.emit('media_ended'), 400);
      };

      if (payload.ttsUrl && !CONFIG.muted) {
        audioPlayer.onended = endMsg;
        setTimeout(endMsg, 30000);
      } else {
        setTimeout(endMsg, duration);
      }
      break;
    }

    default:
      socket.emit('media_ended');
  }
}

window.hideAll = function hideAll() {
  mediaContainer.classList.remove('visible');
  messageContainer.classList.remove('visible');
  senderInfo.classList.remove('visible');
  mediaCaption.classList.remove('visible');
  mediaCaption.textContent = '';
  mediaVideo.src = ''; mediaVideo.pause();
  mediaImage.src = '';
  audioPlayer.src = ''; audioPlayer.pause();
}

window.updateOverlayBadge = function updateOverlayBadge() {
  const badge = document.getElementById('overlay-badge');
  if (badge) {
    if (!overlayEnabled) {
      badge.classList.add('visible');
      badge.textContent = '👁 OVERLAY OFF';
    } else {
      badge.classList.remove('visible');
    }
  }
}

// ─── Tauri events (tray) ─────────────────────────────────────────────────────

async function setupTauriEvents() {
  try {
    const invoke = window.__TAURI__.core.invoke;
    const listen = window.__TAURI__.event.listen;
    const { register, unregister } = window.__TAURI__.globalShortcut;

    // Toggle mute depuis le tray
    await listen('toggle_mute', () => {
      CONFIG.muted = !CONFIG.muted;
      muteBadge.classList.toggle('visible', CONFIG.muted);
      if (mediaVideo.src) mediaVideo.muted = CONFIG.muted;
      invoke('save_and_notify', { configJson: JSON.stringify(CONFIG) }).catch(() => {});
    });

    // Toggle overlay depuis le tray
    await listen('toggle_overlay', () => {
      overlayEnabled = !overlayEnabled;
      if (!overlayEnabled) hideAll();
      updateOverlayBadge();
    });

    // Mise à jour config depuis la fenêtre options
    await listen('config_updated', async ({ payload }) => {
      const oldUrl = CONFIG.serverUrl;
      const oldPseudo = CONFIG.pseudo;
      const oldShortcut = CONFIG.shortcut;

      applyConfig(payload);

      if (CONFIG.shortcut !== oldShortcut && CONFIG.shortcut) {
        try {
          await unregister(oldShortcut).catch(() => {});
          await register(CONFIG.shortcut, () => {
            overlayEnabled = !overlayEnabled;
            if (!overlayEnabled) hideAll();
            updateOverlayBadge();
          });
        } catch (e) {
          console.error("Erreur mise à jour raccourci", e);
        }
      }

      if (CONFIG.serverUrl !== oldUrl) {
        if (socket) {
          socket.disconnect();
          // Attendre un peu que le serveur Node gère le 'disconnect'
          setTimeout(() => {
            connectSocket();
          }, 100);
        } else {
          connectSocket();
        }
      } else if (CONFIG.pseudo !== oldPseudo) {
        if (socket && socket.connected) {
          socket.emit('identify', { pseudo: CONFIG.pseudo });
        } else if (!socket) {
          connectSocket();
        }
      }
    });

    // Raccourci clavier → toggle overlay
    if (CONFIG.shortcut) {
      await register(CONFIG.shortcut, () => {
        overlayEnabled = !overlayEnabled;
        if (!overlayEnabled) hideAll();
        updateOverlayBadge();
      });
    }

    // Click-through
    await invoke('set_clickthrough', { enabled: true });

  } catch (err) {
    console.info('[Cacabox] Erreur/Hors contexte Tauri:', err);
  }
}

// ─── Connexion Socket ─────────────────────────────────────────────────────────

function connectSocket() {
  // eslint-disable-next-line no-undef
  socket = io(CONFIG.serverUrl, {
    forceNew: true,
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
  });

  socket.on('connect', () => {
    console.log('[Cacabox] Connecté :', CONFIG.pseudo);
    socket.emit('identify', { pseudo: CONFIG.pseudo });
  });

  socket.on('show', (item) => showItem(item));

  socket.on('disconnect', () => {
    console.warn('[Cacabox] Déconnecté — reconnexion…');
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  await loadConfig();

  if (!CONFIG.pseudo || CONFIG.pseudo === 'CHANGE_MOI') {
    CONFIG.pseudo = 'pc_' + Math.random().toString(36).slice(2, 7);
  }

  await loadSocketIO().catch(() => {
    console.error('[Cacabox] Socket.io introuvable. Serveur démarré ?');
  });

  await setupTauriEvents();
  connectSocket();
})();

