/**
 * BordelBox — options.js
 * Fenêtre de configuration : lecture/sauvegarde via commandes Tauri
 */

async function init() {
  try {
    const { invoke }          = window.__TAURI__.core;
    const { getCurrentWindow } = window.__TAURI__.window;

    // Stocker pour réutilisation
    window._tauriInvoke = invoke;
    window._tauriWindow = getCurrentWindow;

    // Charger la config actuelle
    const raw    = await invoke('load_config');
    const config = JSON.parse(raw);

    document.getElementById('pseudo').value    = config.pseudo    || '';
    document.getElementById('serverUrl').value = config.serverUrl || 'http://141.145.200.136:8123';

    const msgSize = config.messageSize ?? config.textSize ?? 8;
    const capSize = config.captionSize ?? 2.5;
    const ms = config.mediaSize ?? 80;
    const px = config.posX ?? 50;
    const py = config.posY ?? 50;
    const sc = config.shortcut || 'Ctrl+O';

    document.getElementById('messageSize').value  = msgSize;
    document.getElementById('captionSize').value  = capSize;
    document.getElementById('mediaSize').value = ms;
    document.getElementById('posX').value = px;
    document.getElementById('posY').value = py;
    document.getElementById('shortcut').value = sc;
    updateLabels(msgSize, capSize, ms, px, py);

  } catch (e) {
    console.error('[Options] Erreur init :', e);
    document.getElementById('status').textContent = '❌ Erreur init : ' + e;
  }
}

function updateLabels(msgSize, capSize, ms, px, py) {
  document.getElementById('messageSizeVal').textContent   = msgSize + 'vw';
  document.getElementById('captionSizeVal').textContent   = capSize + 'vw';
  document.getElementById('mediaSizeVal').textContent     = ms + '%';
  document.getElementById('messageSizeLabel').textContent = msgSize;
  document.getElementById('captionSizeLabel').textContent = capSize;
  document.getElementById('mediaSizeLabel').textContent   = ms;
  if(px !== undefined) document.getElementById('posXLabel').textContent = px;
  if(py !== undefined) document.getElementById('posYLabel').textContent = py;
}

document.getElementById('posX').addEventListener('input', (e) => {
  document.getElementById('posXLabel').textContent = e.target.value;
});

document.getElementById('posY').addEventListener('input', (e) => {
  document.getElementById('posYLabel').textContent = e.target.value;
});

document.getElementById('messageSize').addEventListener('input', (e) => {
  const v = e.target.value;
  document.getElementById('messageSizeVal').textContent   = v + 'vw';
  document.getElementById('messageSizeLabel').textContent = v;
});

document.getElementById('captionSize').addEventListener('input', (e) => {
  const v = e.target.value;
  document.getElementById('captionSizeVal').textContent   = v + 'vw';
  document.getElementById('captionSizeLabel').textContent = v;
});

document.getElementById('mediaSize').addEventListener('input', (e) => {
  const v = e.target.value;
  document.getElementById('mediaSizeVal').textContent   = v + '%';
  document.getElementById('mediaSizeLabel').textContent = v;
});

window.resetOverlayOptions = function () {
  document.getElementById('messageSize').value = 8;
  document.getElementById('captionSize').value = 2.5;
  document.getElementById('mediaSize').value = 80;
  document.getElementById('posX').value = 50;
  document.getElementById('posY').value = 50;
  updateLabels(8, 2.5, 80, 50, 50);
};

// Enregistrement du raccourci clavier
function handleShortcutInput(e, inputId) {
  e.preventDefault();

  const key = e.key;
  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') {
    return; // On ignore les modificateurs seuls
  }

  if (key === 'Backspace' || key === 'Escape') {
    document.getElementById(inputId).value = '';
    return;
  }

  const modifiers = [];
  if (e.ctrlKey) modifiers.push('Ctrl');
  if (e.altKey) modifiers.push('Alt');
  if (e.shiftKey) modifiers.push('Shift');
  if (e.metaKey) modifiers.push('Command'); // Command (Mac) ou Super (Win)

  // Nettoyer le nom de la touche
  let keyName = key;
  if (key === ' ') keyName = 'Space';
  else if (key.length === 1) keyName = key.toUpperCase(); // Lettre ou symbole

  const newShortcut = [...modifiers, keyName].join('+');
  document.getElementById(inputId).value = newShortcut;
}

document.getElementById('shortcut').addEventListener('keydown', (e) => handleShortcutInput(e, 'shortcut'));

window.saveOptions = async function () {
  const config = {
    pseudo:      document.getElementById('pseudo').value.trim().toLowerCase(),
    serverUrl:   document.getElementById('serverUrl').value.trim().replace(/\/$/, ''),
    messageSize: parseFloat(document.getElementById('messageSize').value),
    captionSize: parseFloat(document.getElementById('captionSize').value),
    mediaSize:   parseInt(document.getElementById('mediaSize').value, 10),
    posX:        parseInt(document.getElementById('posX').value, 10),
    posY:        parseInt(document.getElementById('posY').value, 10),
    shortcut:    document.getElementById('shortcut').value.trim(),
  };

  if (!config.pseudo) {
    document.getElementById('status').textContent = '⚠️ Pseudo vide !';
    return;
  }

  try {
    await window._tauriInvoke('save_and_notify', { configJson: JSON.stringify(config) });
    document.getElementById('status').textContent = '✅ Sauvegardé !';
    setTimeout(() => {
      document.getElementById('status').textContent = '';
    }, 2000);
  } catch (e) {
    document.getElementById('status').textContent = '❌ Erreur : ' + e;
  }
};

window.closeWindow = async function () {
  try {
    const win = window._tauriWindow();
    await win.hide();
  } catch {}
};

init();
