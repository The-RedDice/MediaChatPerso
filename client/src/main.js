/**
 * BordelBox Client — main.js
 * Socket.io + affichage + mute/disable + config dynamique + raccourcis
 */

// ─── Config par défaut ────────────────────────────────────────────────────────

let CONFIG = {
  pseudo:      'unknown',
  serverUrl:   'http://141.145.200.136:8123',
  messageSize: 8,    // vw
  captionSize: 2.5,  // vw
  mediaSize:   80,   // % écran
  muted:       true,
  shortcut:    'Ctrl+O',
};

let overlayEnabled = true;
let socket;

// ─── Éléments DOM ─────────────────────────────────────────────────────────────

const mediaContainer  = document.getElementById('media-container');
const mediaVideo      = document.getElementById('media-video');
const mediaImage      = document.getElementById('media-image');
const mediaCaption    = document.getElementById('media-caption');
const captionText     = document.getElementById('caption-text');
const captionEffects  = document.getElementById('caption-effects');
const senderInfo      = document.getElementById('sender-info');
const senderAvatar    = document.getElementById('sender-avatar');
const senderName      = document.getElementById('sender-name');
const messageContainer = document.getElementById('message-container');
const messageText     = document.getElementById('message-text');
const messageEffects  = document.getElementById('message-effects');
const audioPlayer     = document.getElementById('audio-player');
const muteBadge       = document.getElementById('mute-badge');
const audioVisualizer = document.getElementById('audio-visualizer');

const mediaProgressContainer = document.getElementById('media-progress-container');
const mediaProgressFill      = document.getElementById('media-progress-fill');
const mediaProgressText      = document.getElementById('media-progress-text');

const audioProgressContainer = document.getElementById('audio-progress-container');
const audioProgressFill      = document.getElementById('audio-progress-fill');
const audioProgressText      = document.getElementById('audio-progress-text');

const voteskipContainer      = document.getElementById('voteskip-container');
const voteskipCount          = document.getElementById('voteskip-count');

// ─── Format Time ──────────────────────────────────────────────────────────────
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ─── Update Progress ──────────────────────────────────────────────────────────
function updateProgress(currentTime, duration) {
  if (!duration || isNaN(duration)) return;
  const percent = (currentTime / duration) * 100;
  if (mediaProgressFill) mediaProgressFill.style.width = `${percent}%`;
  if (mediaProgressText) mediaProgressText.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
}

function updateAudioProgress(currentTime, duration) {
  if (!duration || isNaN(duration)) return;
  const percent = (currentTime / duration) * 100;
  if (audioProgressFill) audioProgressFill.style.width = `${percent}%`;
  if (audioProgressText) audioProgressText.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
}

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
    const parsedConfig = JSON.parse(raw);
    parsedConfig.muted = true; // Force mute au lancement
    applyConfig(parsedConfig);
  } catch {
    // Fallback navigateur (mode dev)
    try {
      const res = await fetch('./config.json');
      const parsedConfig = await res.json();
      parsedConfig.muted = true; // Force mute au lancement
      applyConfig(parsedConfig);
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

  // Connecte le lecteur audio (pour /sendfile audio et TTS)
  source = audioContext.createMediaElementSource(audioPlayer);
  source.connect(analyser);

  // Connecte le lecteur vidéo (pour /sendurl, yt-dlp, et fichiers vidéos directs)
  const videoSource = audioContext.createMediaElementSource(mediaVideo);
  videoSource.connect(analyser);

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

// ─── Effets et Styles ────────────────────────────────────────────────────────

function applyStyle(payload, textElement, effectsElement) {
  const style = payload.style || {};

  if (!textElement) return;

  if (style.color) {
    textElement.style.color = style.color;
    textElement.style.textShadow = `2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 0 10px ${style.color}`;
  } else {
    textElement.style.color = '';
    textElement.style.textShadow = '';
  }

  if (style.font) {
    textElement.style.fontFamily = style.font;
  } else {
    textElement.style.fontFamily = '';
  }

  // Animation de texte (surtout pour le message)
  textElement.style.animation = 'none';
  textElement.offsetHeight; // force reflow

  // Reset typewriter specific state
  textElement.classList.remove('typewriter-text');
  if (textElement._typewriterInterval) {
    clearInterval(textElement._typewriterInterval);
    textElement._typewriterInterval = null;
  }

  if (style.animation) {
    if (style.animation === 'fade') textElement.style.animation = 'msg-fade 0.5s ease-in-out both';
    else if (style.animation === 'slide') textElement.style.animation = 'msg-slide 0.5s cubic-bezier(0.25, 1, 0.5, 1) both';
    else if (style.animation === 'zoom') textElement.style.animation = 'msg-zoom 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both';
    else if (style.animation === 'bounce') textElement.style.animation = 'msg-bounce 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both';
    else if (style.animation === 'spin') textElement.style.animation = 'msg-spin 0.6s cubic-bezier(0.25, 1, 0.5, 1) both';
    else if (style.animation === 'shake') textElement.style.animation = 'msg-shake 0.5s ease-in-out both';
    else if (style.animation === 'drop') textElement.style.animation = 'msg-drop 0.5s cubic-bezier(0.25, 1, 0.5, 1) both';
    else if (style.animation === 'glitch') textElement.style.animation = 'msg-glitch 0.4s infinite linear both';
    else if (style.animation === 'pulse') textElement.style.animation = 'msg-pulse 1s infinite ease-in-out both';
    else if (style.animation === 'typewriter') {
      textElement.style.animation = 'none';
      textElement.classList.add('typewriter-text');

      const fullText = textElement.textContent;
      textElement.textContent = '';

      let index = 0;
      textElement._typewriterInterval = setInterval(() => {
        if (index < fullText.length) {
          textElement.textContent += fullText.charAt(index);
          index++;
        } else {
          clearInterval(textElement._typewriterInterval);
          textElement._typewriterInterval = null;
        }
      }, 50);
    }
  } else {
    // Par défaut
    if (textElement === messageText) textElement.style.animation = 'msg-bounce 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both';
    else textElement.style.animation = 'msg-fade 0.3s ease both';
  }

  // Appliquer les particules dans le conteneur cible (s'il y en a un)
  if (effectsElement) {
    effectsElement.innerHTML = '';
    const effectTypes = ['particules', 'etoiles', 'confetti', 'feu', 'neige', 'coeurs', 'matrix'];
    if (effectTypes.includes(style.effect)) {
      const effectType = style.effect;
      let count = 50;
      if (effectType === 'etoiles' || effectType === 'confetti') count = 30;
      else if (effectType === 'neige' || effectType === 'matrix') count = 80;
      else if (effectType === 'coeurs') count = 20;

      for (let i = 0; i < count; i++) {
        const el = document.createElement('div');

        if (effectType === 'etoiles') el.className = 'star';
        else if (effectType === 'confetti') el.className = 'confetti';
        else if (effectType === 'feu') el.className = 'fire';
        else if (effectType === 'neige') el.className = 'snow';
        else if (effectType === 'coeurs') el.className = 'heart';
        else if (effectType === 'matrix') {
          el.className = 'matrix-char';
          el.textContent = String.fromCharCode(0x30A0 + Math.random() * 96);
        }
        else el.className = 'particle';

        // Tailles aléatoires
        let size = Math.random() * 10 + 5;
        if (effectType === 'etoiles') size = Math.random() * 15 + 5;
        else if (effectType === 'feu') size = Math.random() * 20 + 10;
        else if (effectType === 'neige') size = Math.random() * 6 + 2;
        else if (effectType === 'matrix') size = Math.random() * 16 + 10;

        el.style.width = `${size}px`;
        el.style.height = `${size}px`;

        // Position relative stricte à la zone du texte
        el.style.left = `${Math.random() * 100}%`;

        if (effectType === 'feu') {
           el.style.top = `${Math.random() * 20 + 80}%`; // Le feu commence plus bas
        } else {
           el.style.top = `${Math.random() * 100}%`;
        }

        el.style.animationDelay = `${Math.random() * 2}s`;
        el.style.animationDuration = `${Math.random() * 2 + 1.5}s`;

        if (effectType === 'feu') {
          // Si c'est du feu, les couleurs vont du jaune au rouge, ou on utilise la custom color
          el.style.background = style.color ? style.color : (Math.random() > 0.5 ? '#ff5500' : '#ffaa00');
        } else if (effectType === 'confetti') {
          // Confettis ont des couleurs aléatoires si l'user n'a pas défini de couleur
          const colors = ['#ff0', '#0f0', '#00f', '#f00', '#f0f', '#0ff'];
          el.style.background = style.color ? style.color : colors[Math.floor(Math.random() * colors.length)];
        } else {
          // Particules/étoiles normales
          if (style.color) {
            el.style.background = style.color;
          }
        }

        effectsElement.appendChild(el);
      }
    }
  }
}

// ─── Affichage ────────────────────────────────────────────────────────────────

function getCssFilter(filterName) {
  if (!filterName) return '';
  switch (filterName) {
    case 'grayscale': return 'grayscale(100%)';
    case 'sepia': return 'sepia(100%)';
    case 'invert': return 'invert(100%)';
    case 'blur': return 'blur(5px)';
    case 'contrast': return 'contrast(200%)';
    case 'saturate': return 'saturate(300%)';
    default: return '';
  }
}

// Fonction utilitaire pour proxifier les URLs externes et contourner le blocage Web Audio CORS
function getPlayableUrl(url) {
  if (!url) return '';
  if (url.startsWith(CONFIG.serverUrl)) return url; // Déjà sur notre serveur local
  if (url.startsWith('data:')) return url; // Base64
  return `${CONFIG.serverUrl}/api/proxy?url=${encodeURIComponent(url)}`;
}

function handleFile(payload) {
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
    if (audioProgressContainer) {
      audioProgressContainer.classList.add('visible');
      audioPlayer.ontimeupdate = () => updateAudioProgress(audioPlayer.currentTime, audioPlayer.duration);
    }
  } else if (fileType === 'video') {
    if (mediaProgressContainer) {
      mediaProgressContainer.classList.add('visible');
      mediaVideo.ontimeupdate = () => updateProgress(mediaVideo.currentTime, mediaVideo.duration);
    }
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

    // Appliquer le filtre s'il existe (si c'est greenscreen, il ne faut pas l'écraser, mais le greenscreen est appliqué en CSS via la classe)
    mediaVideo.style.filter = '';
    if (payload.filter && !payload.greenscreen) {
       mediaVideo.style.filter = getCssFilter(payload.filter);
    }

    mediaContainer.classList.add('visible');

    if (payload.ttsUrl && !CONFIG.muted) {
      mediaVideo.volume = 0.2;
    }

    if (payload.caption) {
      captionText.textContent = payload.caption;
      applyStyle(payload, captionText, captionEffects);
      mediaCaption.classList.add('visible');
    }

    mediaVideo.play().then(() => startVisualizer()).catch(e => console.error("Erreur lecture vidéo :", e));

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

    // Appliquer le filtre
    mediaImage.style.filter = '';
    if (payload.filter && !payload.greenscreen) {
       mediaImage.style.filter = getCssFilter(payload.filter);
    }

    mediaContainer.classList.add('visible');

    if (payload.caption) {
      captionText.textContent = payload.caption;
      applyStyle(payload, captionText, captionEffects);
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
}

function handleMessage(payload) {
  messageText.textContent = payload.text;

  if (payload.greenscreen) {
    messageText.classList.add('greenscreen');
  } else {
    messageText.classList.remove('greenscreen');
  }

  applyStyle(payload, messageText, messageEffects);
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
}

function handleMedia(payload) {
  if (mediaProgressContainer) {
    mediaProgressContainer.classList.add('visible');
    mediaVideo.ontimeupdate = () => updateProgress(mediaVideo.currentTime, mediaVideo.duration);
  }
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

  mediaVideo.style.filter = '';
  if (payload.filter && !payload.greenscreen) {
     mediaVideo.style.filter = getCssFilter(payload.filter);
  }

  mediaContainer.classList.add('visible');

  // Si TTS est joué, baisser le volume de la vidéo
  if (payload.ttsUrl && !CONFIG.muted) {
    mediaVideo.volume = 0.2;
  }

  // Caption optionnelle
  if (payload.caption) {
    captionText.textContent = payload.caption;
    applyStyle(payload, captionText, captionEffects);
    mediaCaption.classList.add('visible');
  }

  // Lancer la lecture explicitement après avoir configuré la source
  mediaVideo.play().then(() => startVisualizer()).catch(e => console.error("Erreur lecture vidéo :", e));

  mediaVideo.onended = () => { hideAll(); socket.emit('media_ended'); };
  mediaVideo.onerror = () => { hideAll(); socket.emit('media_ended'); };
}

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
    captionText.textContent = '';
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
    audioPlayer.src = getPlayableUrl(payload.ttsUrl);
    audioPlayer.play().then(() => startVisualizer()).catch(() => {});
  }

  switch (type) {

    case 'media':
      handleMedia(payload);
      break;

    case 'file':
      handleFile(payload);
      break;

    case 'message':
      handleMessage(payload);
      break;

    default:
      socket.emit('media_ended');
  }
}

window.hideAll = function hideAll() {
  mediaVideo.onended = null;
  mediaVideo.onerror = null;
  mediaVideo.ontimeupdate = null;
  audioPlayer.onended = null;
  audioPlayer.onerror = null;
  audioPlayer.ontimeupdate = null;

  stopVisualizer();

  mediaContainer.classList.remove('visible');
  messageContainer.classList.remove('visible');
  senderInfo.classList.remove('visible');
  mediaCaption.classList.remove('visible');
  captionText.textContent = '';
  messageText.textContent = '';
  captionEffects.innerHTML = '';
  messageEffects.innerHTML = '';
  mediaVideo.src = ''; mediaVideo.pause();
  mediaImage.src = '';
  audioPlayer.src = ''; audioPlayer.pause();
  if (mediaProgressContainer) {
    mediaProgressContainer.classList.remove('visible');
    if (mediaProgressFill) mediaProgressFill.style.width = '0%';
    if (mediaProgressText) mediaProgressText.textContent = '0:00 / 0:00';
  }

  if (audioProgressContainer) {
    audioProgressContainer.classList.remove('visible');
    if (audioProgressFill) audioProgressFill.style.width = '0%';
    if (audioProgressText) audioProgressText.textContent = '0:00 / 0:00';
  }

  if (voteskipContainer) {
    voteskipContainer.classList.remove('visible');
    if (voteskipCount) voteskipCount.textContent = '0/0';
  }
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

      const newConfig = typeof payload === 'string' ? JSON.parse(payload) : payload;
      // Ne pas écraser l'état mute actuel avec ce qui vient des options,
      // puisque le bouton mute est dans le tray et indépendant des options.
      newConfig.muted = CONFIG.muted;

      applyConfig(newConfig);

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
        console.error("[BordelBox] Impossible d'enregistrer le raccourci initial:", e);
      }
    }

    // Click-through
    await invoke('set_clickthrough', { enabled: true });

  } catch (err) {
    console.info('[BordelBox] Erreur/Hors contexte Tauri:', err);
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
    console.log('[BordelBox] Connecté :', CONFIG.pseudo);
    socket.emit('identify', { pseudo: CONFIG.pseudo });
  });

  socket.on('show', (item) => showItem(item));

  socket.on('force_skip', () => {
    hideAll();
    socket.emit('media_ended');
  });

  socket.on('voteskip_update', (data) => {
    if (voteskipContainer && voteskipCount && data.requiredVotes > 0) {
      voteskipCount.textContent = `${data.currentVotes}/${data.requiredVotes}`;
      voteskipContainer.classList.add('visible');
    }
  });

  socket.on('disconnect', () => {
    console.warn('[BordelBox] Déconnecté — reconnexion…');
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
    console.error('[BordelBox] Socket.io introuvable. Serveur démarré ?');
  });

  await setupTauriEvents();
  connectSocket();
})();

