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

  // Badge mute
  muteBadge.classList.toggle('visible', !!CONFIG.muted);
}

// ─── Chargement config (Tauri ou fetch fallback) ──────────────────────────────

async function loadConfig() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke('load_config');
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

  // Afficher l'expéditeur Discord si présent
  if (payload.senderName) {
    senderName.textContent  = payload.senderName;
    senderAvatar.src        = payload.avatarUrl || '';
    senderAvatar.style.display = payload.avatarUrl ? 'block' : 'none';
    senderInfo.classList.add('visible');
  }

  switch (type) {

    case 'media': {
      hideAll();
      const src = `${CONFIG.serverUrl}/media/${payload.filename}`;
      mediaVideo.style.display = 'block';
      mediaImage.style.display = 'none';
      mediaVideo.src    = src;
      mediaVideo.muted  = !!CONFIG.muted;
      mediaVideo.volume = 1;
      mediaContainer.classList.add('visible');

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
      hideAll();
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

        setTimeout(() => { hideAll(); socket.emit('media_ended'); }, 5000);
      }
      break;
    }

    case 'message': {
      hideAll();
      messageText.textContent = payload.text;
      messageText.style.animation = 'none';
      messageText.offsetHeight;
      messageText.style.animation = '';
      messageContainer.classList.add('visible');

      const duration = Math.min(8000, Math.max(3000, payload.text.length * 60));
      setTimeout(() => {
        messageContainer.classList.remove('visible');
        setTimeout(() => socket.emit('media_ended'), 400);
      }, duration);
      break;
    }

    default:
      socket.emit('media_ended');
  }
}

function hideAll() {
  mediaContainer.classList.remove('visible');
  messageContainer.classList.remove('visible');
  senderInfo.classList.remove('visible');
  mediaCaption.classList.remove('visible');
  mediaCaption.textContent = '';
  mediaVideo.src = ''; mediaVideo.pause();
  mediaImage.src = '';
  audioPlayer.src = ''; audioPlayer.pause();
}

// ─── Tauri events (tray) ─────────────────────────────────────────────────────

async function setupTauriEvents() {
  try {
    const { listen }  = await import('@tauri-apps/api/event');
    const { invoke }  = await import('@tauri-apps/api/core');
    const { register } = await import('@tauri-apps/plugin-global-shortcut');

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
    });

    // Mise à jour config depuis la fenêtre options
    await listen('config_updated', ({ payload }) => {
      const oldUrl = CONFIG.serverUrl;
      const oldPseudo = CONFIG.pseudo;
      applyConfig(payload);

      // Si le serveur a changé, on se reconnecte vraiment
      if (CONFIG.serverUrl !== oldUrl) {
        if (socket) socket.disconnect();
        connectSocket();
      }
      // Sinon, si seul le pseudo a changé, on se ré-identifie sur le même socket
      else if (socket && socket.connected && CONFIG.pseudo !== oldPseudo) {
        socket.emit('identify', { pseudo: CONFIG.pseudo });
      }
    });

    // Raccourci clavier : Ctrl+Shift+D → toggle overlay
    await register('Ctrl+Shift+D', () => {
      overlayEnabled = !overlayEnabled;
      if (!overlayEnabled) hideAll();
    });

    // Click-through
    await invoke('set_clickthrough', { enabled: true });

  } catch {
    console.info('[Cacabox] Hors contexte Tauri');
  }
}

// ─── Connexion Socket ─────────────────────────────────────────────────────────

function connectSocket() {
  // eslint-disable-next-line no-undef
  socket = io(CONFIG.serverUrl, {
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

