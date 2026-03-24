const fs = require('fs');
const path = require('path');
const { getItemsDb, addItemToInventory, removeItemFromInventory, addCoins, spendCoins, getInventory } = require('./stats');

const MARKET_FILE = path.join(__dirname, 'market.json');

let market = [];

try {
  if (fs.existsSync(MARKET_FILE)) {
    const data = fs.readFileSync(MARKET_FILE, 'utf8');
    market = JSON.parse(data);
  }
} catch (err) {
  console.error('[Market] Erreur lors du chargement:', err);
}

function saveMarket() {
  try {
    fs.writeFileSync(MARKET_FILE, JSON.stringify(market, null, 2));
  } catch (err) {
    console.error('[Market] Erreur lors de la sauvegarde:', err);
  }
}

function createListing(sellerId, sellerName, itemId, price) {
  const inventory = getInventory(sellerId);
  if (!inventory.items[itemId] || inventory.items[itemId] <= 0) {
    return { error: "Vous ne possédez pas cet objet." };
  }

  if (price <= 0) {
    return { error: "Le prix doit être supérieur à 0." };
  }

  // Remove item from inventory to put it on the market
  if (removeItemFromInventory(sellerId, itemId)) {
    const listingId = `list_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    market.push({
      id: listingId,
      sellerId,
      sellerName,
      itemId,
      price,
      createdAt: Date.now()
    });
    saveMarket();

    const itemsDb = getItemsDb();
    let itemName = itemId;
    for (const cat in itemsDb) {
      if (itemsDb[cat][itemId]) {
        itemName = itemsDb[cat][itemId].name;
        break;
      }
    }

    return { ok: true, listingId, itemName };
  }

  return { error: "Erreur lors de la suppression de l'objet de l'inventaire." };
}

function buyListing(buyerId, listingId) {
  const listingIndex = market.findIndex(l => l.id === listingId);
  if (listingIndex === -1) {
    return { error: "Cette offre n'existe plus." };
  }

  const listing = market[listingIndex];

  if (listing.sellerId === buyerId) {
    return { error: "Vous ne pouvez pas acheter votre propre objet." };
  }

  if (spendCoins(buyerId, listing.price)) {
    // Give money to seller
    addCoins(listing.sellerId, listing.price);
    // Give item to buyer
    addItemToInventory(buyerId, listing.itemId);

    // Remove listing
    market.splice(listingIndex, 1);
    saveMarket();

    const itemsDb = getItemsDb();
    let itemName = listing.itemId;
    for (const cat in itemsDb) {
      if (itemsDb[cat][listing.itemId]) {
        itemName = itemsDb[cat][listing.itemId].name;
        break;
      }
    }

    return { ok: true, item: listing.itemId, itemName };
  } else {
    return { error: "Fonds insuffisants." };
  }
}

function cancelListing(sellerId, listingId) {
  const listingIndex = market.findIndex(l => l.id === listingId);
  if (listingIndex === -1) {
    return { error: "Cette offre n'existe plus." };
  }

  const listing = market[listingIndex];

  if (listing.sellerId !== sellerId) {
    return { error: "Vous n'êtes pas le vendeur de cet objet." };
  }

  // Return item to seller
  addItemToInventory(sellerId, listing.itemId);

  // Remove listing
  market.splice(listingIndex, 1);
  saveMarket();

  return { ok: true };
}

function getListings() {
  const itemsDb = getItemsDb();
  // Enrich listings with item info
  return market.map(listing => {
    let itemInfo = null;
    for (const cat in itemsDb) {
      if (itemsDb[cat][listing.itemId]) {
        itemInfo = itemsDb[cat][listing.itemId];
        break;
      }
    }
    return { ...listing, itemInfo };
  });
}

module.exports = {
  createListing,
  buyListing,
  cancelListing,
  getListings
};
