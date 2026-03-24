const { getInventory, addItemToInventory, removeItemFromInventory, addCoins, spendCoins, getItemsDb } = require('./stats');

// trades in-memory: { tradeId: { senderId, receiverId, senderOffer: { items: [], coins: 0 }, receiverOffer: { items: [], coins: 0 }, status: 'pending' } }
const trades = new Map();

function createTradeRequest(senderId, senderName, receiverId, receiverName) {
  if (senderId === receiverId) return { error: "Vous ne pouvez pas échanger avec vous-même." };

  const tradeId = `trade_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  trades.set(tradeId, {
    id: tradeId,
    senderId,
    senderName,
    receiverId,
    receiverName,
    senderOffer: { items: [], coins: 0 },
    receiverOffer: { items: [], coins: 0 },
    status: 'pending',
    createdAt: Date.now()
  });

  // Nettoyage automatique après 5 minutes
  setTimeout(() => {
    if (trades.has(tradeId) && trades.get(tradeId).status === 'pending') {
      trades.delete(tradeId);
    }
  }, 5 * 60 * 1000);

  return { ok: true, tradeId };
}

function updateTradeOffer(tradeId, userId, offerItems, offerCoins) {
  const trade = trades.get(tradeId);
  if (!trade || trade.status !== 'pending') return { error: "Échange introuvable ou déjà terminé." };

  let isSender = (userId === trade.senderId);
  if (!isSender && userId !== trade.receiverId) return { error: "Vous ne participez pas à cet échange." };

  // Validate inventory
  const inventory = getInventory(userId);
  const itemsDb = getItemsDb();

  // Create a copy of the inventory counts to simulate the offer and ensure they have everything
  const tempInv = { ...inventory.items };
  for (const itemId of offerItems) {
    if (!tempInv[itemId] || tempInv[itemId] <= 0) {
      // Find item name for better error message
      let itemName = itemId;
      for (const cat in itemsDb) {
        if (itemsDb[cat][itemId]) {
          itemName = itemsDb[cat][itemId].name;
          break;
        }
      }
      return { error: `Vous n'avez pas assez de ${itemName}.` };
    }
    tempInv[itemId]--;
  }

  // TODO: Validate coins (need to check user stats directly or pass it)
  // For simplicity, assuming the caller has verified coin balance or will verify at accept.

  if (isSender) {
    trade.senderOffer = { items: offerItems, coins: offerCoins };
  } else {
    trade.receiverOffer = { items: offerItems, coins: offerCoins };
  }

  return { ok: true, trade };
}

function acceptTrade(tradeId) {
  const trade = trades.get(tradeId);
  if (!trade || trade.status !== 'pending') return { error: "Échange introuvable." };

  // 1. Verify everything again before executing

  // Verify sender
  for (const itemId of trade.senderOffer.items) {
    if (!removeItemFromInventory(trade.senderId, itemId)) {
      return { error: "Échec : L'initiateur ne possède plus tous les objets promis." };
    }
  }
  if (trade.senderOffer.coins > 0) {
    if (!spendCoins(trade.senderId, trade.senderOffer.coins)) {
       // Rollback items
       trade.senderOffer.items.forEach(id => addItemToInventory(trade.senderId, id));
       return { error: "Échec : L'initiateur n'a pas assez de pièces." };
    }
  }

  // Verify receiver
  for (const itemId of trade.receiverOffer.items) {
    if (!removeItemFromInventory(trade.receiverId, itemId)) {
      // Rollback sender
      trade.senderOffer.items.forEach(id => addItemToInventory(trade.senderId, id));
      if (trade.senderOffer.coins > 0) addCoins(trade.senderId, trade.senderOffer.coins);
      return { error: "Échec : Le destinataire ne possède plus tous les objets promis." };
    }
  }
  if (trade.receiverOffer.coins > 0) {
    if (!spendCoins(trade.receiverId, trade.receiverOffer.coins)) {
       // Rollback receiver items
       trade.receiverOffer.items.forEach(id => addItemToInventory(trade.receiverId, id));
       // Rollback sender
       trade.senderOffer.items.forEach(id => addItemToInventory(trade.senderId, id));
       if (trade.senderOffer.coins > 0) addCoins(trade.senderId, trade.senderOffer.coins);
       return { error: "Échec : Le destinataire n'a pas assez de pièces." };
    }
  }

  // 2. Transfer!
  trade.senderOffer.items.forEach(id => addItemToInventory(trade.receiverId, id));
  if (trade.senderOffer.coins > 0) addCoins(trade.receiverId, trade.senderOffer.coins);

  trade.receiverOffer.items.forEach(id => addItemToInventory(trade.senderId, id));
  if (trade.receiverOffer.coins > 0) addCoins(trade.senderId, trade.receiverOffer.coins);

  trade.status = 'accepted';
  trades.delete(tradeId);

  return { ok: true };
}

function declineTrade(tradeId) {
  if (trades.has(tradeId)) {
    trades.get(tradeId).status = 'declined';
    trades.delete(tradeId);
  }
  return { ok: true };
}

function getTrade(tradeId) {
  return trades.get(tradeId) || null;
}

module.exports = {
  createTradeRequest,
  updateTradeOffer,
  acceptTrade,
  declineTrade,
  getTrade
};
