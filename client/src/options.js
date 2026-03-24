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
    document.getElementById('discordId').value = config.discordId || '';
    document.getElementById('serverUrl').value = config.serverUrl || 'http://141.145.200.136:8123';

    const msgSize = config.messageSize ?? config.textSize ?? 8;
    const capSize = config.captionSize ?? 2.5;
    const ms = config.mediaSize ?? 80;
    const px = config.posX ?? 50;
    const py = config.posY ?? 50;
    const vol = config.volume ?? 100;
    const opa = config.opacity ?? 100;
    const sc = config.shortcut || 'Ctrl+O';

    document.getElementById('messageSize').value  = msgSize;
    document.getElementById('captionSize').value  = capSize;
    document.getElementById('mediaSize').value = ms;
    document.getElementById('posX').value = px;
    document.getElementById('posY').value = py;
    document.getElementById('volume').value = vol;
    document.getElementById('opacity').value = opa;
    document.getElementById('shortcut').value = sc;
    document.getElementById('enableAiModel').checked = (config.enableAiModel !== false);
    updateLabels(msgSize, capSize, ms, px, py, vol, opa);

    // Vérification de la version
    checkVersion();

  } catch (e) {
    console.error('[Options] Erreur init :', e);
    document.getElementById('status').textContent = '❌ Erreur init : ' + e;
  }
}

async function checkVersion() {
  try {
    let currentVersion = '1.0.0';
    if (window.__TAURI__) {
      currentVersion = await window.__TAURI__.app.getVersion();
    }

    document.getElementById('current-version').textContent = `v${currentVersion}`;

    if (!navigator.onLine) return; // Pas internet

    const res = await fetch('https://api.github.com/repos/The-RedDice/MediaChatPerso/releases/latest');
    if (!res.ok) return;
    const data = await res.json();

    if (data && data.tag_name) {
      const latestVersion = data.tag_name.replace(/^v/, '');

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
        let downloadUrl = data.html_url;
        if (data.assets && data.assets.length > 0) {
          const exeAsset = data.assets.find(a => a.name.endsWith('.exe'));
          if (exeAsset) downloadUrl = exeAsset.browser_download_url;
        }

        const linkContainer = document.getElementById('update-link-container');
        const link = document.getElementById('update-link');

        link.textContent = `🚨 Mise à jour v${latestVersion} disponible ! Cliquez ici 🚨`;
        link.href = '#';
        link.onclick = (e) => {
          e.preventDefault();
          if (window.__TAURI__) {
            window.__TAURI__.plugin.shell.open(downloadUrl).catch(console.error);
          } else {
            window.open(downloadUrl, '_blank');
          }
        };
        linkContainer.style.display = 'block';
      }
    }
  } catch (err) {
    console.warn("Erreur lors de la vérification de version dans les options:", err);
  }
}

function updateLabels(msgSize, capSize, ms, px, py, vol, opa) {
  document.getElementById('messageSizeVal').textContent   = msgSize + 'vw';
  document.getElementById('captionSizeVal').textContent   = capSize + 'vw';
  document.getElementById('mediaSizeVal').textContent     = ms + '%';
  document.getElementById('messageSizeLabel').textContent = msgSize;
  document.getElementById('captionSizeLabel').textContent = capSize;
  document.getElementById('mediaSizeLabel').textContent   = ms;
  if(px !== undefined) document.getElementById('posXLabel').textContent = px;
  if(py !== undefined) document.getElementById('posYLabel').textContent = py;
  if(vol !== undefined) {
    document.getElementById('volumeVal').textContent = vol + '%';
    document.getElementById('volumeLabel').textContent = vol;
  }
  if(opa !== undefined) {
    document.getElementById('opacityVal').textContent = opa + '%';
    document.getElementById('opacityLabel').textContent = opa;
  }
}

document.getElementById('volume').addEventListener('input', (e) => {
  const v = e.target.value;
  document.getElementById('volumeVal').textContent = v + '%';
  document.getElementById('volumeLabel').textContent = v;
});

document.getElementById('opacity').addEventListener('input', (e) => {
  const v = e.target.value;
  document.getElementById('opacityVal').textContent = v + '%';
  document.getElementById('opacityLabel').textContent = v;
});

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
  document.getElementById('volume').value = 100;
  document.getElementById('opacity').value = 100;
  updateLabels(8, 2.5, 80, 50, 50, 100, 100);
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
    discordId:   document.getElementById('discordId').value.trim(),
    serverUrl:   document.getElementById('serverUrl').value.trim().replace(/\/$/, ''),
    messageSize: parseFloat(document.getElementById('messageSize').value),
    captionSize: parseFloat(document.getElementById('captionSize').value),
    mediaSize:   parseInt(document.getElementById('mediaSize').value, 10),
    posX:        parseInt(document.getElementById('posX').value, 10),
    posY:        parseInt(document.getElementById('posY').value, 10),
    volume:      parseInt(document.getElementById('volume').value, 10),
    opacity:     parseInt(document.getElementById('opacity').value, 10),
    shortcut:    document.getElementById('shortcut').value.trim(),
    enableAiModel: document.getElementById('enableAiModel').checked,
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
