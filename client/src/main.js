/**
 * Cacabox Client — main.js
 * Socket.io + affichage + mute/disable + config dynamique + raccourcis
 */

// ─── Config par défaut ────────────────────────────────────────────────────────

let CONFIG = {
  pseudo:      'unknown',
  serverUrl:   'http://localhost:3000',
  messageSize: 8,    // vw
  captionSize: 2.5,  // vw
  mediaSize:   80,   // % écran
  muted:       false,
  shortcut:    'Ctrl+O',
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
const audioVisualizer = document.getElementById('audio-visualizer');

// ─── Application de la config ─────────────────────────────────────────────────

function applyConfig(cfg) {
  if (typeof cfg === 'string') cfg = JSON.parse(cfg);
  CONFIG = { ...CONFIG, ...cfg };

  // Rétrocompatibilité
  if (CONFIG.textSize && !CONFIG.messageSize) {
    CONFIG.messageSize = CONFIG.textSize;
  }
  if (!CONFIG.captionSize) {
    CONFIG.captionSize = 2.5;
  }

  // Variables CSS pour les tailles
  document.documentElement.style.setProperty('--message-size', `${CONFIG.messageSize}vw`);
  document.documentElement.style.setProperty('--caption-size', `${CONFIG.captionSize}vw`);
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
    if (overlayEnabled) {
      badge.classList.add('visible');
      badge.textContent = '👁️';
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

// ─── Audio Visualizer ────────────────────────────────────────────────────────

let audioContext, analyser, source, dataArray;
let isVisualizerSetup = false;
let animationFrameId;

function setupAudioVisualizer() {
  if (isVisualizerSetup) return;
  // Nécessite une interaction utilisateur ou sera activé à la première lecture (Chrome policy)
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 64; // Petit buffer pour dessiner quelques barres (32 bins)
  source = audioContext.createMediaElementSource(audioPlayer);
  source.connect(analyser);
  analyser.connect(audioContext.destination);

  const bufferLength = analyser.frequencyBinCount;
  dataArray = new Uint8Array(bufferLength);
  isVisualizerSetup = true;
}

function startVisualizer() {
  if (!isVisualizerSetup) {
    try { setupAudioVisualizer(); } catch (e) { console.warn("Visualizer init failed", e); return; }
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  const canvas = audioVisualizer;
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');

  // High-DPI canvas
  const size = 120; // 60px * 2 pour la résolution
  canvas.width = size;
  canvas.height = size;
  ctx.scale(2, 2);

  const cx = 30; // Centre
  const cy = 30;
  const radius = 22; // Rayon de base (autour de l'avatar 36x36 -> r=18)

  function draw() {
    animationFrameId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, 60, 60);

    const bars = dataArray.length;
    const step = (Math.PI * 2) / bars;

    for (let i = 0; i < bars; i++) {
      const value = dataArray[i];
      const percent = value / 255;
      const height = percent * 8; // Max 8px de hauteur

      if (height === 0) continue;

      const angle = i * step - Math.PI / 2;

      const x1 = cx + Math.cos(angle) * radius;
      const y1 = cy + Math.sin(angle) * radius;

      const x2 = cx + Math.cos(angle) * (radius + height);
      const y2 = cy + Math.sin(angle) * (radius + height);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = `rgba(255, 60, 110, ${0.5 + percent * 0.5})`; // Rouge-rose
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  draw();
}

function stopVisualizer() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  audioVisualizer.style.display = 'none';
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

  // Fonction utilitaire pour proxifier les URLs externes et contourner le blocage Web Audio CORS
  const getPlayableUrl = (url) => {
    if (!url) return '';
    if (url.startsWith(CONFIG.serverUrl)) return url; // Déjà sur notre serveur local
    if (url.startsWith('data:')) return url; // Base64
    return `${CONFIG.serverUrl}/api/proxy?url=${encodeURIComponent(url)}`;
  };

  // Si un son TTS est fourni, on le met en route via audioPlayer (seulement si non mute)
  if (payload.ttsUrl && !CONFIG.muted) {
    audioPlayer.src = getPlayableUrl(payload.ttsUrl);
    audioPlayer.play().then(() => startVisualizer()).catch(() => {});
  }

  switch (type) {

    case 'media': {
      const src = `${CONFIG.serverUrl}/media/${payload.filename}`;
      mediaVideo.style.display = 'block';
      mediaImage.style.display = 'none';
      mediaVideo.src    = src;
      mediaVideo.muted  = !!CONFIG.muted;
      mediaVideo.volume = 1;

      if (payload.greenscreen) {
        mediaVideo.classList.add('greenscreen');
      } else {
        mediaVideo.classList.remove('greenscreen');
      }

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

      // Lancer la lecture explicitement après avoir configuré la source
      mediaVideo.play().catch(e => console.error("Erreur lecture vidéo :", e));

      mediaVideo.onended = () => { hideAll(); socket.emit('media_ended'); };
      mediaVideo.onerror = () => { hideAll(); socket.emit('media_ended'); };
      break;
    }

    case 'file': {
      const { url, fileType } = payload;

      if (fileType === 'audio') {
        if (CONFIG.muted) { socket.emit('media_ended'); return; }
        audioPlayer.src = getPlayableUrl(url);
        audioPlayer.play()
          .then(() => startVisualizer())
          .catch((err) => {
            console.error("Audio play failed:", err);
            hideAll();
            socket.emit('media_ended');
          });

        audioPlayer.onended = () => {
          hideAll();
          socket.emit('media_ended');
        };
        audioPlayer.onerror = () => {
          console.error("Audio load failed");
          hideAll();
          socket.emit('media_ended');
        };
      } else if (fileType === 'video') {
        mediaVideo.style.display = 'block';
        mediaImage.style.display = 'none';
        mediaVideo.src = url;
        mediaVideo.muted = !!CONFIG.muted;
        mediaVideo.volume = 1;

        if (payload.greenscreen) {
          mediaVideo.classList.add('greenscreen');
        } else {
          mediaVideo.classList.remove('greenscreen');
        }

        mediaContainer.classList.add('visible');

        if (payload.ttsUrl && !CONFIG.muted) {
          mediaVideo.volume = 0.2;
        }

        if (payload.caption) {
          mediaCaption.textContent = payload.caption;
          mediaCaption.classList.add('visible');
        }

        mediaVideo.play().catch(e => console.error("Erreur lecture vidéo :", e));

        mediaVideo.onended = () => { hideAll(); socket.emit('media_ended'); };
        mediaVideo.onerror = () => { hideAll(); socket.emit('media_ended'); };
      } else {
        mediaImage.style.display = 'block';
        mediaVideo.style.display = 'none';
        mediaImage.src = url;

        if (payload.greenscreen) {
          mediaImage.classList.add('greenscreen');
        } else {
          mediaImage.classList.remove('greenscreen');
        }

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

      if (payload.greenscreen) {
        messageText.classList.add('greenscreen');
      } else {
        messageText.classList.remove('greenscreen');
      }

      messageContainer.classList.add('visible');

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
  mediaVideo.onended = null;
  mediaVideo.onerror = null;
  audioPlayer.onended = null;
  audioPlayer.onerror = null;

  stopVisualizer();

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
    if (overlayEnabled) {
      badge.classList.add('visible');
      badge.textContent = '👁️';
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
      invoke('update_tray_menu', { overlayEnabled, isMuted: CONFIG.muted }).catch(() => {});
    });

    // Toggle overlay depuis le tray
    await listen('toggle_overlay', () => {
      overlayEnabled = !overlayEnabled;
      if (!overlayEnabled) hideAll();
      updateOverlayBadge();
      invoke('update_tray_menu', { overlayEnabled, isMuted: CONFIG.muted }).catch(() => {});
    });

    // Système de debounce pour le raccourci global afin d'éviter le double-trigger
    // propre à certaines configurations (ex. Tauri v2 / Windows)
    let lastToggleTime = 0;
    const toggleOverlaySafely = () => {
      const now = Date.now();
      if (now - lastToggleTime < 300) return; // Debounce de 300ms
      lastToggleTime = now;

      overlayEnabled = !overlayEnabled;
      if (!overlayEnabled) hideAll();
      updateOverlayBadge();
      invoke('update_tray_menu', { overlayEnabled, isMuted: CONFIG.muted }).catch(() => {});
    };

    // Mise à jour config depuis la fenêtre options
    await listen('config_updated', async ({ payload }) => {
      const oldUrl = CONFIG.serverUrl;
      const oldPseudo = CONFIG.pseudo;
      const oldShortcut = CONFIG.shortcut;

      applyConfig(payload);

      if (CONFIG.shortcut !== oldShortcut && CONFIG.shortcut) {
        try {
          await unregister(oldShortcut).catch(() => {});
          await register(CONFIG.shortcut, (shortcut) => {
            if (shortcut && shortcut.state === "Released") return; // Si la propriété state existe, ignorer le relâchement
            toggleOverlaySafely();
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
      try {
        await unregister(CONFIG.shortcut).catch(() => {});
        await register(CONFIG.shortcut, (e) => {
          if (e.state === "Pressed") {
            overlayEnabled = !overlayEnabled;
            if (!overlayEnabled) hideAll();
            updateOverlayBadge();
            invoke('update_tray_menu', { overlayEnabled, isMuted: CONFIG.muted }).catch(() => {});
          }
        });
      } catch (e) {
        console.error("[Cacabox] Impossible d'enregistrer le raccourci initial:", e);
      }
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

  socket.on('force_skip', () => {
    hideAll();
    socket.emit('media_ended');
  });

  socket.on('disconnect', () => {
    console.warn('[Cacabox] Déconnecté — reconnexion…');
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  await loadConfig();
  updateOverlayBadge(); // Afficher l'œil par défaut au lancement

  if (!CONFIG.pseudo || CONFIG.pseudo === 'CHANGE_MOI') {
    CONFIG.pseudo = 'pc_' + Math.random().toString(36).slice(2, 7);
  }

  await loadSocketIO().catch(() => {
    console.error('[Cacabox] Socket.io introuvable. Serveur démarré ?');
  });

  await setupTauriEvents();
  connectSocket();
})();

