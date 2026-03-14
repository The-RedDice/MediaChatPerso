/* ─── BordelBox Panel JS ──────────────────────────────────── */
'use strict';

const socket = io({ path: '/socket.io' });

// ─── État ────────────────────────────────────────────────
let connectedClients = [];
let queueData = {};
let historyData = [];

// ─── Tabs ────────────────────────────────────────────────
window.switchTab = function(tab) {
  const btns = document.querySelectorAll('.tab-btn');
  btns.forEach(btn => btn.classList.remove('active'));
  document.querySelector(`.tab-btn[onclick="switchTab('${tab}')"]`).classList.add('active');

  document.getElementById('tab-send').style.display = 'none';
  document.getElementById('tab-queue').style.display = 'none';
  document.getElementById('tab-history').style.display = 'none';

  if (tab === 'send') {
    document.getElementById('tab-send').style.display = 'block';
  } else if (tab === 'queue') {
    document.getElementById('tab-queue').style.display = 'block';
    fetchQueue();
  } else if (tab === 'history') {
    document.getElementById('tab-history').style.display = 'block';
    fetchHistory();
  }
};

// ─── Connexion Socket ────────────────────────────────────
socket.on('connect', () => {
  setConn(true);
  log('Connecté au serveur', 'ok');
});
socket.on('disconnect', () => {
  setConn(false);
  log('Déconnecté du serveur', 'err');
});
socket.on('clients_update', (list) => {
  connectedClients = list;
  renderClients(list);
});
socket.on('queue_update', (qData) => {
  queueData = qData;
  renderQueue();
});
socket.on('history_update', (hData) => {
  historyData = hData;
  renderHistory();
});
socket.on('panel_log', (data) => {
  if (data && data.msg) {
    log(data.msg, data.type || 'info');
  }
});

function setConn(ok) {
  const dot   = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  dot.className = 'dot ' + (ok ? 'connected' : 'disconnected');
  label.textContent = ok ? 'Connecté' : 'Déconnecté';
}

// ─── Rendu clients ───────────────────────────────────────
function renderClients(list) {
  const ul   = document.getElementById('client-list');
  const pills = document.getElementById('target-pills');

  ul.innerHTML = '';
  pills.innerHTML = '';

  if (list.length === 0) {
    ul.innerHTML = '<li class="empty">Aucun client</li>';
    return;
  }

  list.forEach(pseudo => {
    // Sidebar
    const li = document.createElement('li');
    li.textContent = pseudo;
    ul.appendChild(li);

    // Radio pill
    const label = document.createElement('label');
    label.className = 'radio-pill';
    label.innerHTML = `<input type="radio" name="target" value="${pseudo}"> ${pseudo}`;
    pills.appendChild(label);
  });
}

function getTarget() {
  const checked = document.querySelector('input[name="target"]:checked');
  return checked ? checked.value : 'all';
}

// ─── Actions ─────────────────────────────────────────────
async function sendUrl() {
  const url    = document.getElementById('url-input').value.trim();
  const target = getTarget();
  if (!url) return;

  const wrap   = document.getElementById('url-progress');
  const status = document.getElementById('url-status');
  wrap.classList.remove('hidden');
  status.textContent = 'Téléchargement en cours…';

  try {
    const res  = await api('POST', '/api/sendurl', { url, target });
    status.textContent = 'Envoyé !';
    log(`sendurl → ${target} : ${res.filename}`, 'ok');
    document.getElementById('url-input').value = '';
    setTimeout(() => wrap.classList.add('hidden'), 2000);
  } catch (e) {
    status.textContent = 'Erreur : ' + e.message;
    log('sendurl error : ' + e.message, 'err');
    setTimeout(() => wrap.classList.add('hidden'), 3000);
  }
}

async function sendFile() {
  const fileUrl  = document.getElementById('file-input').value.trim();
  const fileType = document.getElementById('file-type').value;
  const target   = getTarget();
  if (!fileUrl) return;

  try {
    await api('POST', '/api/sendfile', { fileUrl, fileType, target });
    log(`sendfile → ${target} : ${fileType}`, 'ok');
    document.getElementById('file-input').value = '';
  } catch (e) {
    log('sendfile error : ' + e.message, 'err');
  }
}

async function sendMessage() {
  const text   = document.getElementById('msg-input').value.trim();
  const target = getTarget();
  if (!text) return;

  try {
    await api('POST', '/api/message', { text, target });
    log(`message → ${target} : "${text}"`, 'ok');
    document.getElementById('msg-input').value = '';
  } catch (e) {
    log('message error : ' + e.message, 'err');
  }
}

// ─── Fetch helper ────────────────────────────────────────
async function api(method, endpoint, body) {
  const res = await fetch(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ─── Queue ───────────────────────────────────────────────
async function fetchQueue() {
  try {
    const data = await api('GET', '/api/queue');
    queueData = data;
    renderQueue();
  } catch(e) { console.error('Erreur fetchQueue', e); }
}

function renderQueue() {
  const tbody = document.getElementById('queue-tbody');
  tbody.innerHTML = '';

  let count = 0;
  for (const [pseudo, q] of Object.entries(queueData)) {
    q.forEach((item, index) => {
      count++;
      const tr = document.createElement('tr');

      const dateStr = item.enqueuedAt ? new Date(item.enqueuedAt).toLocaleTimeString('fr-FR') : 'N/A';
      const sender = item.payload?.senderName || 'Système';
      let previewHtml = '';
      if (item.type === 'message') {
        // Aperçu du texte brut avec troncature
        let txt = item.payload.text || '';
        if (txt.length > 30) txt = txt.substring(0, 30) + '…';
        previewHtml = `<span style="color:var(--text);font-size:0.8rem;">[TXT] ${txt}</span>`;
      } else if (item.type === 'media') {
        previewHtml = `<a href="${item.payload.url}" target="_blank" style="color:var(--accent);text-decoration:none;">[VID] Voir la vidéo</a>`;
        if (item.payload.caption) previewHtml += `<br><span style="font-size:0.75rem;color:var(--muted)">"${item.payload.caption}"</span>`;
      } else if (item.type === 'file') {
        const url = item.payload.url;
        if (item.payload.fileType === 'audio') {
           previewHtml = `<a href="${url}" target="_blank" style="color:var(--green);text-decoration:none;">[AUD] Écouter</a>`;
        } else if (item.payload.fileType === 'video') {
           previewHtml = `<a href="${url}" target="_blank" style="color:var(--accent);text-decoration:none;">[VID] Voir la vidéo</a>`;
        } else {
           previewHtml = `<a href="${url}" target="_blank" style="color:var(--green);text-decoration:none;">[IMG] <img src="${url}" style="height:24px; vertical-align:middle; border-radius:3px; margin-left:4px;"></a>`;
        }
        if (item.payload.caption) previewHtml += `<br><span style="font-size:0.75rem;color:var(--muted)">"${item.payload.caption}"</span>`;
      }

      tr.innerHTML = `
        <td>#${index + 1}</td>
        <td><strong>${pseudo}</strong></td>
        <td>${dateStr}</td>
        <td>${sender}</td>
        <td>${previewHtml}</td>
        <td>
          <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.7rem;" onclick="removeFromQueue('${pseudo}', ${index})">Suppr.</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  if (count === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--muted);">Aucun élément en attente</td></tr>';
  }
}

window.removeFromQueue = async function(pseudo, index) {
  try {
    await api('DELETE', `/api/queue/${pseudo}/${index}`);
    log(`Supprimé pos #${index+1} pour ${pseudo}`, 'ok');
  } catch(e) {
    log(`Erreur suppr queue: ${e.message}`, 'err');
  }
}

// ─── History ─────────────────────────────────────────────
async function fetchHistory() {
  try {
    historyData = await api('GET', '/api/history');
    renderHistory();
  } catch(e) { console.error('Erreur fetchHistory', e); }
}

function renderHistory() {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!historyData || historyData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color: var(--muted);">Aucun historique</td></tr>';
    return;
  }

  historyData.forEach(item => {
    const tr = document.createElement('tr');

    const dateStr = item.playedAt ? new Date(item.playedAt).toLocaleTimeString('fr-FR') : 'N/A';
    const sender = item.payload?.senderName || 'Système';
    let previewHtml = '';

    if (item.type === 'message') {
      let txt = item.payload.text || '';
      if (txt.length > 50) txt = txt.substring(0, 50) + '…';
      previewHtml = `<span style="color:var(--text);font-size:0.8rem;">[TXT] ${txt}</span>`;
    } else if (item.type === 'media') {
      previewHtml = `<a href="${item.payload.url}" target="_blank" style="color:var(--accent);text-decoration:none;">[VID] Voir la vidéo</a>`;
      if (item.payload.caption) previewHtml += `<br><span style="font-size:0.75rem;color:var(--muted)">"${item.payload.caption}"</span>`;
    } else if (item.type === 'file') {
      const url = item.payload.url;
      if (item.payload.fileType === 'audio') {
         previewHtml = `<a href="${url}" target="_blank" style="color:var(--green);text-decoration:none;">[AUD] Écouter</a>`;
      } else if (item.payload.fileType === 'video') {
         previewHtml = `<a href="${url}" target="_blank" style="color:var(--accent);text-decoration:none;">[VID] Voir la vidéo</a>`;
      } else {
         previewHtml = `<a href="${url}" target="_blank" style="color:var(--green);text-decoration:none;">[IMG] <img src="${url}" style="height:24px; vertical-align:middle; border-radius:3px; margin-left:4px;"></a>`;
      }
      if (item.payload.caption) previewHtml += `<br><span style="font-size:0.75rem;color:var(--muted)">"${item.payload.caption}"</span>`;
    }

    tr.innerHTML = `
      <td>${dateStr}</td>
      <td><strong>${item.targetPseudo}</strong></td>
      <td>${sender}</td>
      <td>${previewHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Log ─────────────────────────────────────────────────
function log(msg, type = 'info') {
  const ul = document.getElementById('log-list');
  const li = document.createElement('li');
  li.className = type;
  const now = new Date().toLocaleTimeString('fr-FR', { hour12: false });
  li.innerHTML = `<span class="ts">${now}</span><span class="tag">[${type.toUpperCase()}]</span> ${msg}`;
  ul.prepend(li);
  if (ul.children.length > 100) ul.removeChild(ul.lastChild);
}

// ─── Init ────────────────────────────────────────────────
(async () => {
  try {
    const { clients } = await api('GET', '/api/clients');
    connectedClients = clients;
    renderClients(clients);
    log(`Panel chargé — ${clients.length} client(s) en ligne`, 'info');
  } catch (_) {}
})();

// Enter key shortcuts
document.getElementById('url-input') .addEventListener('keydown', e => e.key === 'Enter' && sendUrl());
document.getElementById('file-input').addEventListener('keydown', e => e.key === 'Enter' && sendFile());
document.getElementById('msg-input') .addEventListener('keydown', e => e.key === 'Enter' && sendMessage());
