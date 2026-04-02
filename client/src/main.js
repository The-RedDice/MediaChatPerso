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
const senderCrown     = document.getElementById('sender-crown');
const senderName      = document.getElementById('sender-name');
const messageContainer = document.getElementById('message-container');
const messageText     = document.getElementById('message-text');
const messageEffects  = document.getElementById('message-effects');
const audioPlayer     = document.getElementById('audio-player');
const muteBadge       = document.getElementById('mute-badge');
const audioVisualizer = document.getElementById('audio-visualizer');

const drawCanvas      = document.getElementById('draw-canvas');
const drawCtx         = drawCanvas ? drawCanvas.getContext('2d') : null;

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

  // Application des positions et opacité
  const px = (CONFIG.posX !== undefined) ? CONFIG.posX : 50;
  const py = (CONFIG.posY !== undefined) ? CONFIG.posY : 50;
  const opacity = (CONFIG.opacity !== undefined) ? CONFIG.opacity : 100;

  document.documentElement.style.setProperty('--pos-x', `${px}%`);
  document.documentElement.style.setProperty('--pos-y', `${py}%`);
  document.documentElement.style.setProperty('--overlay-opacity', opacity / 100);

  // Mettre à jour le volume si les médias sont en cours de lecture (s'ils existent)
  const vol = (CONFIG.volume !== undefined) ? (CONFIG.volume / 100) : 1;
  if (mediaVideo) mediaVideo.volume = vol;
  if (audioPlayer) audioPlayer.volume = vol;

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
    else if (style.animation === 'swing') textElement.style.animation = 'msg-swing 1s ease-in-out both';
    else if (style.animation === 'wobble') textElement.style.animation = 'msg-wobble 1s ease-in-out both';
    else if (style.animation === 'flip') textElement.style.animation = 'msg-flip 0.6s ease-out both';
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
    const effectTypes = ['particules', 'etoiles', 'confetti', 'feu', 'neige', 'coeurs', 'matrix', 'pluie', 'bulles', 'eclairs'];
    if (effectTypes.includes(style.effect)) {
      const effectType = style.effect;
      let count = 50;
      if (effectType === 'etoiles' || effectType === 'confetti') count = 30;
      else if (effectType === 'neige' || effectType === 'matrix' || effectType === 'pluie') count = 80;
      else if (effectType === 'coeurs') count = 20;
      else if (effectType === 'bulles') count = 40;
      else if (effectType === 'eclairs') count = 5;

      for (let i = 0; i < count; i++) {
        const el = document.createElement('div');

        if (effectType === 'etoiles') el.className = 'star';
        else if (effectType === 'confetti') el.className = 'confetti';
        else if (effectType === 'feu') el.className = 'fire';
        else if (effectType === 'neige') el.className = 'snow';
        else if (effectType === 'coeurs') el.className = 'heart';
        else if (effectType === 'pluie') el.className = 'rain';
        else if (effectType === 'bulles') el.className = 'bubble';
        else if (effectType === 'eclairs') el.className = 'lightning';
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
        else if (effectType === 'bulles') size = Math.random() * 25 + 10;
        else if (effectType === 'eclairs') size = 100; // La taille sera gérée en css/pourcentages

        el.style.width = `${size}px`;
        el.style.height = `${size}px`;

        // Position relative stricte à la zone du texte
        el.style.left = `${Math.random() * 100}%`;

        if (effectType === 'feu' || effectType === 'bulles') {
           el.style.top = `${Math.random() * 20 + 80}%`; // Commence plus bas
        } else if (effectType === 'pluie') {
           el.style.top = `-${Math.random() * 50}%`; // Commence plus haut
        } else if (effectType === 'eclairs') {
           el.style.top = `0%`;
           el.style.left = `${Math.random() * 80 + 10}%`;
        } else {
           el.style.top = `${Math.random() * 100}%`;
        }

        if (effectType === 'pluie') {
          el.style.animationDelay = `${Math.random()}s`;
          el.style.animationDuration = `${Math.random() * 0.5 + 0.5}s`;
          el.style.width = '2px';
          el.style.height = `${Math.random() * 20 + 20}px`;
        } else if (effectType === 'eclairs') {
          el.style.animationDelay = `${Math.random() * 4}s`;
          el.style.animationDuration = `0.2s`;
        } else {
          el.style.animationDelay = `${Math.random() * 2}s`;
          el.style.animationDuration = `${Math.random() * 2 + 1.5}s`;
        }

        if (effectType === 'feu') {
          // Si c'est du feu, les couleurs vont du jaune au rouge, ou on utilise la custom color
          el.style.background = style.color ? style.color : (Math.random() > 0.5 ? '#ff5500' : '#ffaa00');
        } else if (effectType === 'pluie') {
          el.style.background = style.color ? style.color : '#a0c4ff';
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
    case 'pixelate': return 'url(#pixelate-filter)'; // Necessite SVG filter dans index.html
    case 'hue-rotate': return 'hue-rotate(90deg)';
    case 'brightness': return 'brightness(200%) contrast(150%)'; // Glow effect hack
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
  const vol = (CONFIG.volume !== undefined) ? (CONFIG.volume / 100) : 1;

  if (fileType === 'audio') {
    if (CONFIG.muted) { socket.emit('media_ended'); return; }
    audioPlayer.src = getPlayableUrl(url);
    audioPlayer.volume = vol;
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
    mediaVideo.volume = vol;

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
      mediaVideo.volume = vol * 0.2;
    }

    if (payload.caption) {
      captionText.textContent = payload.caption;
      applyStyle(payload, captionText, captionEffects);
      mediaCaption.classList.add('visible');
    }

    // Fallback global de sécurité si la vidéo reste bloquée sans démarrer sa lecture
    let videoTimeout = setTimeout(() => {
      console.warn("Vidéo bloquée ou impossible à lancer, passage forcé.");
      hideAll();
      socket.emit('media_ended');
    }, 5000); // 5 secondes pour attendre le début de la lecture

    mediaVideo.play().then(() => {
      clearTimeout(videoTimeout);
      startVisualizer();
    }).catch(e => {
      console.error("Erreur lecture vidéo (autoplay bloqué?) :", e);
      clearTimeout(videoTimeout);
      hideAll();
      socket.emit('media_ended');
    });

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

    let waitTime = payload.duration || 5000;
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


// ─── THREE.JS AI MODEL VARIABLES ───
let aiScene, aiCamera, aiRenderer, aiMixer = null, aiClock;
let aiModelMesh;
let isAiModelInitialized = false;

function initAiModel() {
  if (isAiModelInitialized) return;
  const container = document.getElementById('ai-model-container');
  if (!container) return;

  aiScene = new THREE.Scene();

  aiCamera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  aiCamera.position.z = 5;

  aiRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  aiRenderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(aiRenderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  aiScene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(1, 1, 2);
  aiScene.add(directionalLight);

  aiClock = new THREE.Clock();

  // Load external GLTF/GLB model
  const loader = new THREE.GLTFLoader();
  loader.load(
    './ai_model.glb',
    (gltf) => {
      aiModelMesh = gltf.scene;

      // Center and scale the model
      const box = new THREE.Box3().setFromObject(aiModelMesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 2.5 / maxDim; // Normalize scale to fit the view
      aiModelMesh.scale.setScalar(scale);

      aiModelMesh.position.x = -center.x * scale;
      aiModelMesh.position.y = -center.y * scale;
      aiModelMesh.position.z = -center.z * scale;

      // Store base transform for animations
      aiModelMesh.userData.baseScale = scale;
      aiModelMesh.userData.basePositionY = aiModelMesh.position.y;

      aiScene.add(aiModelMesh);

      // Handle animations if present
      if (gltf.animations && gltf.animations.length > 0) {
        aiMixer = new THREE.AnimationMixer(aiModelMesh);
        const action = aiMixer.clipAction(gltf.animations[0]);
        action.play();
      } else {
        aiMixer = null;
      }

      isAiModelInitialized = true;
      animateAiModel();
    },
    undefined,
    (error) => {
      console.warn("Failed to load ai_model.glb, falling back to basic cube.", error);
      // Fallback: Animated floating cube instead of a GLTF model for now, to ensure it works without assets
      const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
      const material = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x005555, wireframe: true });
      aiModelMesh = new THREE.Mesh(geometry, material);

      aiModelMesh.userData.baseScale = 1;
      aiModelMesh.userData.basePositionY = 0;

      aiScene.add(aiModelMesh);
      isAiModelInitialized = true;
      animateAiModel();
    }
  );
}

function animateAiModel() {
  requestAnimationFrame(animateAiModel);
  if (!isAiModelInitialized) return;

  const delta = aiClock.getDelta();
  const time = aiClock.getElapsedTime();

  if (aiMixer) aiMixer.update(delta);

  if (aiModelMesh) {
    const isCube = aiModelMesh.geometry && aiModelMesh.geometry.type === 'BoxGeometry';
    const baseScale = aiModelMesh.userData.baseScale || 1;
    const basePositionY = aiModelMesh.userData.basePositionY || 0;

    if (isCube) {
       aiModelMesh.rotation.x += 0.5 * delta;
       aiModelMesh.rotation.y += 1.0 * delta;
       aiModelMesh.position.y = basePositionY + Math.sin(time * 5) * 0.2;
    } else {
       // Gentle float and rotate for imported model
       aiModelMesh.rotation.y += 0.5 * delta;
       // Bouncing based on original static Y position
       aiModelMesh.position.y = basePositionY + Math.sin(time * 3) * 0.1;
    }

    // Pulse effect if audio is playing
    if (audioPlayer && !audioPlayer.paused) {
       aiModelMesh.scale.setScalar(baseScale * (1 + Math.sin(time * 20) * 0.05));
    } else {
       aiModelMesh.scale.setScalar(baseScale);
    }
  }

  aiRenderer.render(aiScene, aiCamera);
}

function showAiModel() {
  if (CONFIG.enableAiModel === false) return; // Disabled via options
  initAiModel();
  const container = document.getElementById('ai-model-container');
  if (container) container.style.opacity = '1';
}

function hideAiModel() {
  const container = document.getElementById('ai-model-container');
  if (container) container.style.opacity = '0';
}
// ────────────────────────────────────

function handleMessage(payload) {
  let textToDisplay = payload.text;

  if (payload.isAi) {
    textToDisplay = `🤖\n${textToDisplay}`;
    if (payload.prompt) {
      textToDisplay += `\n\n[Prompt: ${payload.prompt}]`;
    }
  }

  messageText.textContent = textToDisplay;


  if (payload.greenscreen) {
    messageText.classList.add('greenscreen');
  } else {
    messageText.classList.remove('greenscreen');
  }

  if (payload.isAi && payload.modele3d !== false) {
     showAiModel();
  }


  applyStyle(payload, messageText, messageEffects);

  // Force l'override visuel spécifique pour l'IA (ignore le style personnel de l'utilisateur pour le texte)
  if (payload.isAi) {
    messageText.style.fontFamily = 'monospace, "Courier New"';
    messageText.style.color = '#0ff';
    messageText.style.textShadow = '0 0 10px #0ff, 0 0 20px #0ff, 4px 4px 0 #000';
    // Diminuer la taille du texte de l'IA spécifiquement
    messageText.style.fontSize = 'calc(var(--message-size) * 0.4)';
  } else {
    // Reset en cas de texte normal
    messageText.style.fontSize = '';
  }
  messageContainer.classList.add('visible');

  let duration = payload.duration || Math.min(20000, Math.max(6000, payload.text.length * 100));
  let endedEmitted = false;

  const endMsg = () => {
    if (endedEmitted) return;

    endedEmitted = true;
    hideAiModel();

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
  const vol = (CONFIG.volume !== undefined) ? (CONFIG.volume / 100) : 1;
  if (mediaProgressContainer) {
    mediaProgressContainer.classList.add('visible');
    mediaVideo.ontimeupdate = () => updateProgress(mediaVideo.currentTime, mediaVideo.duration);
  }
  const src = `${CONFIG.serverUrl}/media/${payload.filename}`;
  mediaVideo.style.display = 'block';
  mediaImage.style.display = 'none';
  mediaVideo.src    = src;
  mediaVideo.muted  = !!CONFIG.muted;
  mediaVideo.volume = vol;

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
    mediaVideo.volume = vol * 0.2;
  }

  // Caption optionnelle
  if (payload.caption) {
    captionText.textContent = payload.caption;
    applyStyle(payload, captionText, captionEffects);
    mediaCaption.classList.add('visible');
  }

  // Fallback global de sécurité si la vidéo refuse de se lancer (ex. bug ou blocage)
  let videoTimeout = setTimeout(() => {
    console.warn("Média vidéo impossible à lancer, passage forcé.");
    hideAll();
    socket.emit('media_ended');
  }, 5000);

  // Lancer la lecture explicitement après avoir configuré la source
  mediaVideo.play().then(() => {
    clearTimeout(videoTimeout);
    startVisualizer();
  }).catch(e => {
    console.error("Erreur lecture vidéo (autoplay bloqué?) :", e);
    clearTimeout(videoTimeout);
    hideAll();
    socket.emit('media_ended');
  });

  mediaVideo.onended = () => { hideAll(); socket.emit('media_ended'); };
  mediaVideo.onerror = () => { hideAll(); socket.emit('media_ended'); };
}

window.showItem = function showItem(item) {
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
    hideAiModel();
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
    let displayName = payload.senderName;

    function escapeHtml(unsafe) {
        return (unsafe || '').toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    let safeDisplayName = escapeHtml(displayName);

    // Ajout du badge d'inventaire avec style distinct
    if (payload.equippedBadge) {
       // Le badge arrive sous forme d'emoji grâce au serveur
       safeDisplayName = `<span style="margin-right: 0.3em;">${escapeHtml(payload.equippedBadge)}</span>` + safeDisplayName;
    }

    // Ajout du titre d'inventaire
    if (payload.equippedTitle) {
       let safeTitle = escapeHtml(payload.equippedTitle);
       // Nettoyer le titre s'il contient des informations de bonus ou de numéro de série inutiles à l'écran
       // Exemple: "Le Novice" -> OK, "Artefact Maudit du Chaos #1" -> OK.
       safeDisplayName += `<br><span class="user-title" style="font-size: 0.6em; font-weight: normal; opacity: 0.85; letter-spacing: 1px; display: block; text-transform: uppercase;">[${safeTitle}]</span>`;
    }

    senderName.innerHTML = safeDisplayName;

    // Appliquer la couleur spéciale au pseudo
    if (payload.equippedColorHex) {
      if (payload.equippedColorHex.startsWith('linear-gradient') || payload.equippedColorHex.startsWith('radial-gradient')) {
        senderName.style.background = payload.equippedColorHex;
        senderName.style.webkitBackgroundClip = 'text';
        senderName.style.webkitTextFillColor = 'transparent';
        senderName.style.color = 'transparent';
      } else {
        senderName.style.background = 'none';
        senderName.style.webkitBackgroundClip = 'initial';
        senderName.style.webkitTextFillColor = 'initial';
        senderName.style.color = payload.equippedColorHex;
      }
    } else {
       senderName.style.background = 'none';
       senderName.style.webkitBackgroundClip = 'initial';
       senderName.style.webkitTextFillColor = 'initial';
       senderName.style.color = '';
    }

    senderAvatar.src        = payload.avatarUrl || '';
    senderAvatar.style.display = payload.avatarUrl ? 'block' : 'none';
    if (senderCrown) {
      senderCrown.style.display = payload.isRankOne ? 'block' : 'none';
    }
    senderInfo.classList.add('visible');
  } else {
    senderInfo.classList.remove('visible');
    if (senderCrown) senderCrown.style.display = 'none';
  }

  // Si un son TTS est fourni, on le met en route via audioPlayer (seulement si non mute)
  if (payload.ttsUrl && !CONFIG.muted) {
    const vol = (CONFIG.volume !== undefined) ? (CONFIG.volume / 100) : 1;
    audioPlayer.src = getPlayableUrl(payload.ttsUrl);
    audioPlayer.volume = vol;
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
  if (senderCrown) senderCrown.style.display = 'none';
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

  const eventContainer = document.getElementById('event-container');
  if (eventContainer) {
    eventContainer.classList.remove('visible');
  }

  // Interrompre aussi la session de dessin si elle est active
  if (drawCanvas && drawCanvas.style.opacity === '1') {
    drawCanvas.style.opacity = '0';
    isDrawSessionActive = false;
    setTimeout(() => {
      if (drawCtx) drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    }, 300);
    // Optionnel : avertir le serveur que la session a été interrompue par le streamer
  }
}

// ─── Drawing Logic ───
let isDrawSessionActive = false;
let placedImages = []; // Cache pour les éléments <img> (GIFs/Images) ajoutés au DOM

function startDrawSession() {
  if (!drawCanvas || !drawCtx) return;

  // Mettre le canvas à la bonne taille
  drawCanvas.width = window.innerWidth;
  drawCanvas.height = window.innerHeight;

  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  drawCanvas.style.opacity = '1';
  drawCanvas.style.pointerEvents = 'auto'; // allow hover transparency

  const drawImagesContainer = document.getElementById('draw-images-container');
  if (drawImagesContainer) {
      drawImagesContainer.innerHTML = '';
      drawImagesContainer.style.opacity = '1';
  }
  placedImages = [];

  isDrawSessionActive = true;

  console.log('[Draw] Mode dessin activé');
}

function stopDrawSession(emitScreenshot = true) {
  if (!drawCanvas || !isDrawSessionActive) return;

  isDrawSessionActive = false;

  if (emitScreenshot && socket) {
    // We need to composite the DOM images (GIFs) and the canvas strokes together
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = drawCanvas.width;
    finalCanvas.height = drawCanvas.height;
    const finalCtx = finalCanvas.getContext('2d');

    // Draw all DOM images onto the composite canvas first
    placedImages.forEach(imgObj => {
        // Only works for first frame of GIF in screenshot, but that's standard for DataURL exports.
        // The live overlay will still show the animated GIF.
        try {
            finalCtx.drawImage(imgObj.el, imgObj.x, imgObj.y, imgObj.w, imgObj.h);
        } catch(e) {
            console.warn("[Draw] Failed to composite image to screenshot", e);
        }
    });

    // Draw the actual strokes on top
    finalCtx.drawImage(drawCanvas, 0, 0);

    // Capturer le screenshot du canvas combiné
    const base64Image = finalCanvas.toDataURL('image/png');
    socket.emit('draw_screenshot', { target: CONFIG.pseudo, base64Image });
  }

  // Effacer l'écran après un petit délai
  drawCanvas.style.opacity = '0';
  drawCanvas.style.pointerEvents = 'none';
  const drawImagesContainer = document.getElementById('draw-images-container');
  if (drawImagesContainer) drawImagesContainer.style.opacity = '0';

  setTimeout(() => {
    if (drawCtx) drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    if (drawImagesContainer) drawImagesContainer.innerHTML = '';
    placedImages = []; // Vider le cache
  }, 300);

  console.log('[Draw] Mode dessin désactivé');
}

function handleDrawEvent(event) {
  if (!isDrawSessionActive || !drawCanvas || !drawCtx || !overlayEnabled) return;

  const { type, data } = event;

  // Ajustement en fonction de la taille de la fenêtre (le dashboard envoie des pourcentages ou des coords relatives 1920x1080)
  // On assume que le dashboard envoie des coordonnées normalisées de 0 à 1 (x: 0.5 = 50% de la largeur)

  const w = drawCanvas.width;
  const h = drawCanvas.height;

  if (type === 'line') {
    const { x0, y0, x1, y1, color, width } = data;
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.beginPath();
    drawCtx.moveTo(x0 * w, y0 * h);
    drawCtx.lineTo(x1 * w, y1 * h);
    drawCtx.strokeStyle = color || '#ff3c6e';
    drawCtx.lineWidth = width || 5;
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';
    drawCtx.stroke();
  } else if (type === 'erase') {
    const { x0, y0, x1, y1, width } = data;
    drawCtx.globalCompositeOperation = 'destination-out';
    drawCtx.beginPath();
    drawCtx.moveTo(x0 * w, y0 * h);
    drawCtx.lineTo(x1 * w, y1 * h);
    drawCtx.strokeStyle = 'rgba(0,0,0,1)';
    drawCtx.lineWidth = width || 5;
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';
    drawCtx.stroke();
    drawCtx.globalCompositeOperation = 'source-over'; // restore immediately
  } else if (type === 'text') {
    drawCtx.globalCompositeOperation = 'source-over';
    const { text, x, y, color, font, size } = data;
    const pxSize = (size || 30) * (w / 1920); // Échelle basique par rapport au 1080p
    drawCtx.font = `bold ${pxSize}px ${font || 'Arial'}`;
    drawCtx.fillStyle = color || '#fff';
    drawCtx.textAlign = 'center';
    drawCtx.textBaseline = 'middle';

    // Ajout d'une ombre
    drawCtx.shadowColor = 'black';
    drawCtx.shadowBlur = 4;
    drawCtx.shadowOffsetX = 2;
    drawCtx.shadowOffsetY = 2;

    drawCtx.fillText(text, x * w, y * h);

    // Reset de l'ombre
    drawCtx.shadowColor = 'transparent';
    drawCtx.shadowBlur = 0;
    drawCtx.shadowOffsetX = 0;
    drawCtx.shadowOffsetY = 0;
  } else if (type === 'image') {
    const { url, x, y, width, height } = data;
    const drawImagesContainer = document.getElementById('draw-images-container');
    if (!drawImagesContainer) return;

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.style.position = 'absolute';
    // Pointer events none is already on the container, but just in case
    img.style.pointerEvents = 'none';

    img.onload = () => {
        // Calculate dimensions
        const drawW = width * w;
        const ratio = img.naturalHeight / img.naturalWidth;
        const drawH = height ? (height * h) : (drawW * ratio);

        // Centered on x, y
        const left = (x * w) - (drawW / 2);
        const top = (y * h) - (drawH / 2);

        img.style.width = `${drawW}px`;
        img.style.height = `${drawH}px`;
        img.style.left = `${left}px`;
        img.style.top = `${top}px`;

        drawImagesContainer.appendChild(img);
        placedImages.push({ el: img, x: left, y: top, w: drawW, h: drawH });
    };
    img.src = getPlayableUrl(url);

  } else if (type === 'clear') {
    drawCtx.clearRect(0, 0, w, h);
    const drawImagesContainer = document.getElementById('draw-images-container');
    if (drawImagesContainer) drawImagesContainer.innerHTML = '';
    placedImages = [];
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
    socket.emit('identify', { pseudo: CONFIG.pseudo, discordId: CONFIG.discordId });
  });

  socket.on('show', (item) => showItem(item));

  socket.on('force_skip', () => {
    hideAll();
    socket.emit('media_ended');
  });

  socket.on('start_draw_session', (data) => {
    if (data.target === CONFIG.pseudo || data.target === 'all') {
      startDrawSession();
    }
  });

  socket.on('end_draw_session', (data) => {
    if (data.target === CONFIG.pseudo || data.target === 'all') {
      stopDrawSession(data.target === CONFIG.pseudo); // Seulement le PC cible renvoie l'image
    }
  });

  socket.on('draw_event', (eventData) => {
    handleDrawEvent(eventData);
  });

  socket.on('draw_clear', () => {
    if (drawCanvas && drawCtx) {
      drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    }
  });

  // ─── Événements Interactifs ───
  function updateBossHp(currentHp, maxHp) {
    const pct = Math.max(0, Math.min(100, (currentHp / maxHp) * 100));
    const fill = document.getElementById('boss-hp-fill');
    const text = document.getElementById('boss-hp-text');
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = `${currentHp} / ${maxHp} HP`;
  }

  function updateSondageUI(event) {
    const container = document.getElementById('sondage-choices');
    if (!container) return;
    container.innerHTML = '';

    event.choices.forEach((choice, idx) => {
      const votes = event.votes[idx] || 0;
      const pct = event.totalVotes > 0 ? (votes / event.totalVotes) * 100 : 0;

      const div = document.createElement('div');
      div.className = 'sondage-choice';
      div.innerHTML = `
        <div class="sondage-label">
          <span>${choice}</span>
          <span>${votes} (${Math.round(pct)}%)</span>
        </div>
        <div class="sondage-bar-bg">
          <div class="sondage-bar-fill" style="width: ${pct}%"></div>
        </div>
      `;
      container.appendChild(div);
    });
  }

  socket.on('event_start', (event) => {
    if (!overlayEnabled) return;

    const eventContainer = document.getElementById('event-container');
    const eventBoss = document.getElementById('event-boss');
    const eventSondage = document.getElementById('event-sondage');

    eventContainer.classList.add('visible');

    if (event.type === 'boss') {
      eventBoss.style.display = 'block';
      eventSondage.style.display = 'none';

      document.getElementById('boss-name').textContent = event.name;
      const imageUrl = event.image || 'https://cdn-icons-png.flaticon.com/512/1004/1004305.png';

      const faces = document.querySelectorAll('#boss-cube .face');
      faces.forEach(face => {
        face.style.backgroundImage = `url(${imageUrl})`;

        // Appliquer greenscreen s'il y a lieu
        if (event.greenscreen) {
          face.style.filter = 'url(#chroma-key)';
        } else {
          face.style.filter = '';
        }

        // Appliquer les filtres visuels supplémentaires s'il y en a un (et pas déjà de greenscreen SVG)
        if (event.filter && event.filter !== 'aucun') {
           const cssFilt = getCssFilter(event.filter);
           if (!event.greenscreen) face.style.filter = cssFilt; // Greenscreen et filter simple peuvent mal interagir selon les navigateurs
        }
      });

      // Appliquer les effets de particules si demandés
      const cubeScene = document.querySelector('.cube-scene');
      // On retire les anciens effets s'il y en a
      const oldEffects = cubeScene.querySelectorAll('.particle, .snow, .heart, .matrix-char, .star, .confetti, .fire, .rain, .bubble, .lightning');
      oldEffects.forEach(e => e.remove());

      if (event.effect && event.effect !== 'aucun') {
        applyStyle({ style: { effect: event.effect } }, null, cubeScene); // Réutilise applyStyle qui gère l'injection des particules !
      }

      updateBossHp(event.currentHp, event.hp);
    }
    else if (event.type === 'sondage') {
      eventBoss.style.display = 'none';
      eventSondage.style.display = 'block';

      document.getElementById('sondage-question').textContent = event.question;
      updateSondageUI(event);
    }
  });

  socket.on('event_update', (event) => {
    if (!overlayEnabled) return;

    if (event.type === 'boss') {
      updateBossHp(event.currentHp, event.hp);
    } else if (event.type === 'sondage') {
      updateSondageUI(event);
    }
  });

  socket.on('event_end', (event) => {
    if (!overlayEnabled) return;

    const eventContainer = document.getElementById('event-container');
    if (event.type === 'boss' && event.currentHp <= 0) {
      const killer = (event.result && event.result.killer) ? event.result.killer : 'Un héros';
      document.getElementById('boss-hp-text').textContent = `VAINCU PAR ${killer} !`;

      setTimeout(() => {
        eventContainer.classList.remove('visible');
      }, 5000);
    } else {
      eventContainer.classList.remove('visible');
    }
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

// ─── Verification de mise à jour ──────────────────────────────────────────────
async function checkUpdateAndConnectivity() {
  const notificationContainer = document.getElementById('top-notification');
  if (!notificationContainer) return true; // fallback

  const setNotification = (msg) => {
    notificationContainer.textContent = msg;
    notificationContainer.classList.add('visible');
  };

  // 1. Vérification connexion
  if (!navigator.onLine) {
    setNotification("Pas de connexion internet");
    return false; // Bloque le démarrage
  }

  // 2. Vérification mise à jour
  try {
    let currentVersion = '1.0.0';
    if (window.__TAURI__) {
      currentVersion = await window.__TAURI__.app.getVersion();
    }

    const res = await fetch('https://api.github.com/repos/The-RedDice/MediaChatPerso/releases/latest');
    if (!res.ok) return true; // Si l'API GitHub bug, on laisse passer
    const data = await res.json();

    if (data && data.tag_name) {
      const latestTag = data.tag_name;
      const latestVersion = latestTag.replace(/^v/, '');

      // Comparaison basique (ex: "1.0.1" !== "1.0.0")
      // Basic semantic version comparison to only trigger if the latest is newer
      const isNewer = (latest, current) => {
        const lParts = latest.split('.').map(Number);
        const cParts = current.split('.').map(Number);
        for (let i = 0; i < Math.max(lParts.length, cParts.length); i++) {
          const l = lParts[i] || 0;
          const c = cParts[i] || 0;
          if (l > c) return true;
          if (l < c) return false;
        }
        return false;
      };

      if (isNewer(latestVersion, currentVersion)) {
        setNotification(`Mise à jour v${latestVersion} disponible`);

        return false; // Bloque le démarrage car pas à jour
      }
    }
  } catch (err) {
    console.warn("Erreur lors de la vérification de mise à jour:", err);
  }

  return true; // Tout va bien, on continue
}

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  await loadConfig();
  updateOverlayBadge(); // Afficher l'œil par défaut au lancement

  if (!CONFIG.pseudo || CONFIG.pseudo === 'CHANGE_MOI') {
    CONFIG.pseudo = 'pc_' + Math.random().toString(36).slice(2, 7);
  }

  const isUpToDate = await checkUpdateAndConnectivity();
  if (!isUpToDate) {
    console.warn("[BordelBox] Démarrage bloqué (Pas de connexion ou mise à jour requise).");
    return; // On ne charge pas Socket.io ni les événements
  }

  await loadSocketIO().catch(() => {
    console.error('[BordelBox] Socket.io introuvable. Serveur démarré ?');
  });

  await setupTauriEvents();
  connectSocket();
})();

