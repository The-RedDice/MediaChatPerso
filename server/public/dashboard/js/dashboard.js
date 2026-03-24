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
      document.getElementById('login-card').classList.add('hidden');
      document.getElementById('upload-form').classList.remove('hidden');
      document.getElementById('upload-form').style.display = 'block';

      document.getElementById('user-name').textContent = data.user.username;
      document.getElementById('user-avatar').src = data.user.avatar;

      authLabel.textContent = `Connecté: ${data.user.username}`;
      dot.style.background = 'var(--color-success)';
      dot.style.boxShadow = '0 0 10px var(--color-success)';

      // Init Socket.io pour avoir les clients connectés
      initSocket();

      // Load Memes for Soundboard
      loadMemes();

      // Load pending trades
      loadTrades(data.user.id);

      // Load user inventory
      loadInventory(data.user.id);
    } else {
      document.getElementById('login-card').classList.remove('hidden');
      document.getElementById('upload-form').classList.add('hidden');
      document.getElementById('upload-form').style.display = 'none';

      authLabel.textContent = 'Non connecté';
      dot.style.background = 'var(--color-danger)';
      dot.style.boxShadow = '0 0 10px var(--color-danger)';
    }
  } catch (err) {
    console.error("Erreur check auth:", err);
  }
}

async function loadMemes() {
  const grid = document.getElementById('memes-grid');
  try {
    // Fetch user context if available
    let userId = null;
    try {
      const userRes = await fetch('/auth/status');
      if (userRes.ok) {
        const udata = await userRes.json();
        if (udata.authenticated) {
          userId = udata.user.id;
        }
      }
    } catch (e) {}

    if (!userId) {
      grid.innerHTML = '<div style="color: #ff3c6e; text-align: center; grid-column: 1 / -1; padding: 20px;">Veuillez vous connecter.</div>';
      return;
    }

    const res = await fetch(`/api/memes/${userId}`);
    if (!res.ok) throw new Error('Failed to load memes');
    const data = await res.json();
    const memes = data.memes || {};

    grid.innerHTML = '';
    const memeNames = Object.keys(memes);

    if (memeNames.length === 0) {
      grid.innerHTML = '<div style="color: #aaa; text-align: center; grid-column: 1 / -1; padding: 20px;">Vous n\'avez aucun mème sauvegardé.</div>';
      return;
    }

    memeNames.forEach(name => {
      const meme = memes[name];
      const btn = document.createElement('div');
      btn.className = 'meme-btn';

      let icon = '🖼️';
      if (meme.type === 'video') icon = '🎬';
      if (meme.type === 'audio') icon = '🎵';

      btn.innerHTML = `
        <div class="meme-icon">${icon}</div>
        <div class="meme-name">${name}</div>
      `;

      btn.onclick = () => sendMeme(name, meme);
      grid.appendChild(btn);
    });
  } catch (err) {
    console.error("Erreur loadMemes:", err);
    grid.innerHTML = '<div style="color: #ff3c6e; text-align: center; grid-column: 1 / -1; padding: 20px;">Erreur lors du chargement des mèmes.</div>';
  }
}

async function sendMeme(name, memeData) {
  const targetRadio = document.querySelector('input[name="target"]:checked');
  if (!targetRadio) {
    alert("Veuillez sélectionner une cible d'abord.");
    return;
  }
  const target = targetRadio.value;

  // Create a temporary notification/toast
  const notif = document.createElement('div');
  notif.style.position = 'fixed';
  notif.style.bottom = '20px';
  notif.style.right = '20px';
  notif.style.background = '#5865F2';
  notif.style.color = 'white';
  notif.style.padding = '10px 20px';
  notif.style.borderRadius = '8px';
  notif.style.zIndex = '9999';
  notif.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
  notif.style.transition = 'opacity 0.3s ease';
  notif.textContent = `Envoi de "${name}"...`;
  document.body.appendChild(notif);

  try {
    // Fetch user context if available
    let userId = null;
    try {
      const userRes = await fetch('/auth/status');
      if (userRes.ok) {
        const udata = await userRes.json();
        if (udata.authenticated) {
          userId = udata.user.id;
        }
      }
    } catch (e) {}

    // Send via API - similar to how Discord Bot /meme play works
    const payload = {
      url: memeData.url,
      type: memeData.type || 'video',
      target: target,
      caption: memeData.caption || '',
      greenscreen: memeData.greenscreen || false,
      filter: memeData.filter || ''
    };

    if (userId) payload.userId = userId;

    // We don't have user styling/TTS straight from the dashboard yet, but the backend requireAuth handles identity
    const res = await fetch('/api/sendurl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      notif.style.background = 'var(--color-success)';
      notif.textContent = `✅ "${name}" envoyé à ${target === 'all' ? 'tout le monde' : target} !`;
    } else {
      const errData = await res.json();
      notif.style.background = 'var(--color-danger)';
      notif.textContent = `❌ Erreur : ${errData.error || res.statusText}`;
    }
  } catch (err) {
    notif.style.background = 'var(--color-danger)';
    notif.textContent = `❌ Erreur réseau`;
  }

  setTimeout(() => {
    notif.style.opacity = '0';
    setTimeout(() => notif.remove(), 300);
  }, 3000);
}

async function loadTrades(userId) {
  const container = document.getElementById('trade-container');
  try {
    const res = await fetch(`/api/trades/me?userId=${userId}`);
    if (!res.ok) throw new Error('Failed to load trades');
    const data = await res.json();
    const trades = data.pending || [];

    container.innerHTML = '';

    if (trades.length === 0) {
      container.innerHTML = '<div style="color: #aaa; text-align: center; grid-column: 1 / -1; padding: 20px;">Aucune offre d\'échange en cours.</div>';
      return;
    }

    for (const trade of trades) {
      const isSender = trade.senderId === userId;
      const partnerName = isSender ? trade.receiverName : trade.senderName;
      const statusLabel = isSender ? 'Offre envoyée à' : 'Offre reçue de';

      const div = document.createElement('div');
      div.className = 'trade-card';
      div.style.background = 'var(--color-bg)';
      div.style.padding = '15px';
      div.style.borderRadius = '8px';
      div.style.border = '1px solid var(--color-border)';

      // Fetch full item database to resolve names correctly
      let itemsDb = null;
      try {
        const dbRes = await fetch(`/api/items_db?userId=${userId}`);
        if (dbRes.ok) itemsDb = await dbRes.json();
      } catch(e) {}

      const resolveItemNames = (itemIds) => {
         if (!itemIds || itemIds.length === 0) return 'Aucun objet';
         return itemIds.map(id => {
            if (itemsDb) {
               for (const cat in itemsDb) {
                  if (itemsDb[cat][id]) return itemsDb[cat][id].name;
               }
            }
            return id;
         }).join(', ');
      };

      // Show what is being offered by both parties
      const senderOfferItems = resolveItemNames(trade.senderOffer.items);
      const receiverOfferItems = resolveItemNames(trade.receiverOffer.items);
      const senderOfferCoins = trade.senderOffer.coins;
      const receiverOfferCoins = trade.receiverOffer.coins;

      let displayStatus = 'En attente...';
      if (trade.status === 'accepted') displayStatus = 'Accepté';
      else if (trade.status === 'declined') displayStatus = 'Refusé / Annulé';

      div.innerHTML = `
        <h4 style="margin-bottom: 10px; color: var(--color-primary);">${statusLabel} ${partnerName}</h4>
        <div style="font-size: 0.9em; color: #ccc; margin-bottom: 15px;">Statut: ${displayStatus}</div>
        <div style="font-size: 0.9em; color: #ccc; margin-bottom: 10px;">
           <strong>Offre de ${trade.senderName} :</strong><br>
           Objets: ${senderOfferItems}<br>
           Coins: ${senderOfferCoins}
        </div>
        <div style="font-size: 0.9em; color: #ccc; margin-bottom: 15px;">
           <strong>Offre de ${trade.receiverName} :</strong><br>
           Objets: ${receiverOfferItems}<br>
           Coins: ${receiverOfferCoins}
        </div>
        <div style="display: flex; gap: 10px;">
           <button class="btn btn-primary" onclick="openTradeEditor('${trade.id}', '${userId}', ${isSender})">Modifier / Voir</button>
           ${!isSender && trade.status === 'pending' ? `<button class="btn btn-success" onclick="acceptTrade('${trade.id}', '${userId}')">Accepter</button>` : ''}
           <button class="btn btn-danger" onclick="declineTrade('${trade.id}', '${userId}')">Refuser / Annuler</button>
        </div>
      `;
      container.appendChild(div);
    }
  } catch (err) {
    console.error("Erreur loadTrades:", err);
    container.innerHTML = '<div style="color: #ff3c6e; text-align: center; grid-column: 1 / -1; padding: 20px;">Erreur lors du chargement des offres.</div>';
  }
}

let currentTradeId = null;
let currentTradeUserId = null;

async function openTradeEditor(tradeId, userId, isSender) {
  currentTradeId = tradeId;
  currentTradeUserId = userId;

  const modal = document.getElementById('trade-modal');
  modal.style.display = 'flex';

  // Load user inventory to show options
  try {
    const [invRes, dbRes] = await Promise.all([
      fetch(`/api/inventory/${userId}`),
      fetch(`/api/items_db?userId=${userId}`)
    ]);

    if (invRes.ok) {
      const inv = await invRes.json();
      let itemsDb = null;
      if (dbRes.ok) itemsDb = await dbRes.json();

      const container = document.getElementById('trade-modal-items');
      container.innerHTML = '';

      if (!inv.items || Object.keys(inv.items).length === 0) {
        container.innerHTML = '<div style="color: #ccc;">Aucun objet dans l\'inventaire.</div>';
      } else {
        for (const [itemId, count] of Object.entries(inv.items)) {
          let itemName = itemId;
          if (itemsDb) {
             for (const cat in itemsDb) {
                if (itemsDb[cat][itemId]) {
                   itemName = itemsDb[cat][itemId].name;
                   break;
                }
             }
          }

          const div = document.createElement('div');
          div.style.marginBottom = '5px';
          div.innerHTML = `
            <label style="color: #fff; cursor: pointer; display: block; background: rgba(255,255,255,0.02); padding: 5px; border-radius: 4px;">
               <input type="checkbox" value="${itemId}" class="trade-item-checkbox" style="margin-right: 10px;"> ${itemName} <span style="color: #888; font-size: 0.9em;">(x${count})</span>
            </label>
          `;
          container.appendChild(div);
        }
      }
    }
  } catch (err) {
    console.error(err);
  }
}

function closeTradeEditor() {
  document.getElementById('trade-modal').style.display = 'none';
  currentTradeId = null;
  currentTradeUserId = null;
}

async function submitTradeOffer() {
  if (!currentTradeId || !currentTradeUserId) return;

  const checkboxes = document.querySelectorAll('.trade-item-checkbox:checked');
  const offerItems = Array.from(checkboxes).map(cb => cb.value);
  const coinsInput = document.getElementById('trade-coins-input').value;
  const offerCoins = parseInt(coinsInput, 10) || 0;

  try {
    const res = await fetch('/api/trade/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tradeId: currentTradeId, userId: currentTradeUserId, offerItems, offerCoins })
    });

    if (res.ok) {
      closeTradeEditor();
      loadTrades(currentTradeUserId); // Refresh list
    } else {
      const err = await res.json();
      alert('Erreur: ' + err.error);
    }
  } catch (err) {
    alert('Erreur réseau');
  }
}

async function acceptTrade(tradeId, userId) {
  if (!confirm('Êtes-vous sûr de vouloir accepter cet échange ?')) return;
  try {
    const res = await fetch('/api/trade/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tradeId, userId })
    });
    if (res.ok) {
      alert('Échange accepté avec succès !');
      loadTrades(userId);
    } else {
      const err = await res.json();
      alert('Erreur: ' + err.error);
    }
  } catch (err) {
    alert('Erreur réseau');
  }
}

async function declineTrade(tradeId, userId) {
  if (!confirm('Voulez-vous vraiment annuler / refuser cet échange ?')) return;
  try {
    const res = await fetch('/api/trade/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tradeId, userId })
    });
    if (res.ok) {
      loadTrades(userId);
    } else {
      const err = await res.json();
      alert('Erreur: ' + err.error);
    }
  } catch (err) {
    alert('Erreur réseau');
  }
}

async function loadInventory(userId) {
  const container = document.getElementById('inventory-container');
  try {
    const [invRes, dbRes] = await Promise.all([
      fetch(`/api/inventory/${userId}`),
      fetch(`/api/items_db?userId=${userId}`)
    ]);

    if (!invRes.ok || !dbRes.ok) throw new Error('Failed to load inventory');

    const inv = await invRes.json();
    const itemsDb = await dbRes.json();

    container.innerHTML = '';

    if (!inv.items || Object.keys(inv.items).length === 0) {
      container.innerHTML = '<div style="color: #aaa; text-align: center; grid-column: 1 / -1; padding: 20px;">Votre inventaire est vide.</div>';
      return;
    }

    for (const [itemId, count] of Object.entries(inv.items)) {
      let itemName = itemId;
      let itemRarity = 'commun';
      let itemValue = null;
      let itemEmoji = '';

      for (const cat in itemsDb) {
        if (itemsDb[cat][itemId]) {
          const itemInfo = itemsDb[cat][itemId];
          itemName = itemInfo.name;
          itemRarity = itemInfo.rarity || 'commun';
          if (cat === 'colors' && itemInfo.value) itemValue = itemInfo.value;
          if (itemInfo.emoji) itemEmoji = itemInfo.emoji + ' ';
          break;
        }
      }

      let rarityColor = '#FFFFFF';
      if (itemRarity === 'commun') rarityColor = '#2ecc71';
      else if (itemRarity === 'rare') rarityColor = '#3498db';
      else if (itemRarity === 'epique') rarityColor = '#9b59b6';
      else if (itemRarity === 'legendaire') rarityColor = '#f1c40f';
      else if (itemRarity === 'mythique') rarityColor = '#e74c3c';
      else if (itemRarity === 'transcendant') rarityColor = '#ff00ff';

      const div = document.createElement('div');
      div.className = 'meme-btn'; // reuse styling

      let previewHtml = `<div style="font-size: 2rem; color: ${rarityColor};">📦</div>`;

      // Render actual gradient/color if it's a visual item
      if (itemValue) {
         previewHtml = `<div style="width: 40px; height: 40px; border-radius: 50%; background: ${itemValue}; border: 2px solid #fff; box-shadow: 0 0 10px ${itemValue}; margin-bottom: 10px;"></div>`;
      }

      div.innerHTML = `
        ${previewHtml}
        <div style="color: ${rarityColor}; font-size: 0.7em; text-transform: uppercase; letter-spacing: 1px;">${itemRarity}</div>
        <div class="meme-name">${itemEmoji}${itemName}</div>
        <div style="font-size: 0.8em; color: #888;">Quantité: ${count}</div>
      `;

      container.appendChild(div);
    }

  } catch (err) {
    console.error("Erreur loadInventory:", err);
    container.innerHTML = '<div style="color: #ff3c6e; text-align: center; grid-column: 1 / -1; padding: 20px;">Erreur lors du chargement de l\'inventaire.</div>';
  }
}

async function logout() {
  try {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/dashboard'; // Recharge pour virer le querystring
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
  const filter = document.getElementById('filter-select').value;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('target', target);
  formData.append('caption', caption);
  formData.append('ttsVoice', ttsVoice);
  formData.append('greenscreen', greenscreen.toString());
  if (filter) formData.append('filter', filter);

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
