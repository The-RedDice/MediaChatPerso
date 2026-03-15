/**
 * upload.js
 * Logique Frontend pour la page d'upload avec authentification Discord
 */

let socket;
let isConnected = false;

document.addEventListener('DOMContentLoaded', async () => {
  // Vérifier l'état de l'authentification
  await checkAuthStatus();

  // Afficher un message d'erreur si on revient de l'auth avec une erreur
  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get('error');
  if (error === 'not_in_guild') {
    const errDiv = document.getElementById('error-message');
    errDiv.textContent = '❌ Accès refusé : Vous ne faites pas partie du serveur Discord autorisé pour uploader des fichiers.';
    errDiv.style.display = 'block';
  } else if (error === 'auth_failed') {
    const errDiv = document.getElementById('error-message');
    errDiv.textContent = '❌ Échec de l\'authentification Discord.';
    errDiv.style.display = 'block';
  }
});

async function checkAuthStatus() {
  try {
    const res = await fetch('/auth/status');
    const data = await res.json();

    const authLabel = document.getElementById('auth-label');
    const dot = document.querySelector('#auth-status .dot');

    if (data.authenticated) {
      document.getElementById('login-card').style.display = 'none';
      document.getElementById('upload-form').style.display = 'block';

      document.getElementById('user-name').textContent = data.user.username;
      document.getElementById('user-avatar').src = data.user.avatar;

      authLabel.textContent = `Connecté: ${data.user.username}`;
      dot.style.background = 'var(--color-success)';
      dot.style.boxShadow = '0 0 10px var(--color-success)';

      // Init Socket.io pour avoir les clients connectés
      initSocket();
    } else {
      document.getElementById('login-card').style.display = 'block';
      document.getElementById('upload-form').style.display = 'none';

      authLabel.textContent = 'Non connecté';
      dot.style.background = 'var(--color-danger)';
      dot.style.boxShadow = '0 0 10px var(--color-danger)';
    }
  } catch (err) {
    console.error("Erreur check auth:", err);
  }
}

async function logout() {
  try {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/upload'; // Recharge pour virer le querystring
  } catch (err) {
    console.error("Erreur logout:", err);
  }
}

function initSocket() {
  // On utilise le même serveur pour les WS que pour le HTML
  socket = io(window.location.origin);

  socket.on('connect', () => {
    isConnected = true;
    console.log('[Upload] Socket IO connecté');

    // Demander la liste des clients dès la connexion
    fetch('/api/clients')
      .then(res => res.json())
      .then(data => updateTargetPills(data.clients || []))
      .catch(err => console.error("Erreur fetch clients:", err));
  });

  socket.on('clients_update', (clients) => {
    updateTargetPills(clients);
  });
}

function updateTargetPills(clients) {
  const container = document.getElementById('target-pills');
  container.innerHTML = '';

  // Vérifier si la cible actuelle existe toujours
  const currentTarget = document.querySelector('input[name="target"]:checked')?.value;
  let targetExists = currentTarget === 'all';

  clients.forEach(c => {
    if (c === currentTarget) targetExists = true;

    const label = document.createElement('label');
    label.className = 'radio-pill';
    label.innerHTML = `<input type="radio" name="target" value="${c}"> ${c}`;
    container.appendChild(label);
  });

  // Si l'ancienne cible a disparu, forcer à 'all'
  if (!targetExists) {
    const allRadio = document.querySelector('input[name="target"][value="all"]');
    if (allRadio) allRadio.checked = true;
  }
}

async function uploadFile() {
  const fileInput = document.getElementById('file-input');
  if (!fileInput.files.length) {
    alert("Sélectionnez un fichier.");
    return;
  }

  const file = fileInput.files[0];
  const target = document.querySelector('input[name="target"]:checked').value;
  const caption = document.getElementById('caption-input').value.trim();
  const ttsVoice = document.getElementById('tts-input').value.trim();
  const greenscreen = document.getElementById('greenscreen-input').checked;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('target', target);
  formData.append('caption', caption);
  formData.append('ttsVoice', ttsVoice);
  formData.append('greenscreen', greenscreen.toString());

  const progressWrap = document.getElementById('upload-progress');
  const progressBar = document.getElementById('upload-bar');
  const progressStatus = document.getElementById('upload-status');
  const btn = document.getElementById('submit-btn');

  progressWrap.classList.remove('hidden');
  progressWrap.style.display = 'block'; // force visibilité
  btn.disabled = true;
  progressBar.style.width = '0%';
  progressStatus.textContent = 'Upload... 0%';

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);

    // Progression
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = `${percent}%`;
        progressStatus.textContent = `Upload... ${percent}%`;
      }
    };

    xhr.onload = () => {
      btn.disabled = false;
      if (xhr.status === 200) {
        progressBar.style.width = '100%';
        progressBar.style.background = 'var(--color-success)';
        progressStatus.textContent = '✅ Fichier envoyé !';

        // Reset form après 2s
        setTimeout(() => {
          progressWrap.style.display = 'none';
          progressBar.style.background = 'var(--color-primary)';
          fileInput.value = '';
          document.getElementById('caption-input').value = '';
          document.getElementById('greenscreen-input').checked = false;
        }, 3000);
      } else {
        progressBar.style.background = 'var(--color-danger)';
        progressStatus.textContent = `❌ Erreur: ${xhr.statusText}`;
        try {
           const res = JSON.parse(xhr.responseText);
           if (res.error) progressStatus.textContent = `❌ ${res.error}`;
        } catch(e) {}
      }
    };

    xhr.onerror = () => {
      btn.disabled = false;
      progressBar.style.background = 'var(--color-danger)';
      progressStatus.textContent = '❌ Erreur réseau lors de l\'envoi.';
    };

    xhr.send(formData);

  } catch (err) {
    console.error('Erreur :', err);
    btn.disabled = false;
    progressStatus.textContent = '❌ Erreur inattendue.';
    progressBar.style.background = 'var(--color-danger)';
  }
}
