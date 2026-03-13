/**
 * Cacabox — options.js
 * Fenêtre de configuration : lecture/sauvegarde via commandes Tauri
 */

let invoke, emit, getCurrentWindow;

async function init() {
  try {
    ({ invoke }           = await import('@tauri-apps/api/core'));
    ({ getCurrentWindow } = await import('@tauri-apps/api/window'));

    // Charger la config actuelle
    const raw    = await invoke('load_config');
    const config = JSON.parse(raw);

    document.getElementById('pseudo').value     = config.pseudo     || '';
    document.getElementById('serverUrl').value  = config.serverUrl  || 'http://localhost:3000';

    const ts = config.textSize  ?? 8;
    const ms = config.mediaSize ?? 80;

    document.getElementById('textSize').value   = ts;
    document.getElementById('mediaSize').value  = ms;
    updateLabels(ts, ms);

  } catch (e) {
    console.error('[Options] Erreur init :', e);
  }
}

function updateLabels(ts, ms) {
  document.getElementById('textSizeVal').textContent   = ts + 'vw';
  document.getElementById('mediaSizeVal').textContent  = ms + '%';
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
    await invoke('save_and_notify', { configJson: JSON.stringify(config) });
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
    const win = getCurrentWindow();
    await win.hide();
  } catch {}
};

init();
