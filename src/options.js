/**
 * Cacabox — options.js
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
    document.getElementById('serverUrl').value = config.serverUrl || 'http://localhost:3000';

    const ts = config.textSize  ?? 8;
    const ms = config.mediaSize ?? 80;

    document.getElementById('textSize').value  = ts;
    document.getElementById('mediaSize').value = ms;
    updateLabels(ts, ms);

  } catch (e) {
    console.error('[Options] Erreur init :', e);
    document.getElementById('status').textContent = '❌ Erreur init : ' + e;
  }
}

function updateLabels(ts, ms) {
  document.getElementById('textSizeVal').textContent    = ts + 'vw';
  document.getElementById('mediaSizeVal').textContent   = ms + '%';
  document.getElementById('textSizeLabel').textContent  = ts;
  document.getElementById('mediaSizeLabel').textContent = ms;
}

document.getElementById('textSize').addEventListener('input', (e) => {
  const v = e.target.value;
  document.getElementById('textSizeVal').textContent   = v + 'vw';
  document.getElementById('textSizeLabel').textContent = v;
});

document.getElementById('mediaSize').addEventListener('input', (e) => {
  const v = e.target.value;
  document.getElementById('mediaSizeVal').textContent   = v + '%';
  document.getElementById('mediaSizeLabel').textContent = v;
});

window.saveOptions = async function () {
  const config = {
    pseudo:    document.getElementById('pseudo').value.trim().toLowerCase(),
    serverUrl: document.getElementById('serverUrl').value.trim().replace(/\/$/, ''),
    textSize:  parseFloat(document.getElementById('textSize').value),
    mediaSize: parseInt(document.getElementById('mediaSize').value, 10),
    muted:     false,
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
