/**
 * Trading System for Aspects of Power.
 * Handles player-to-player item trading via dialog. Extensible for currency,
 * NPC vendors, multi-item bundles in future phases.
 */

import { AspectsofPowerItem } from '../documents/item.mjs';

export class TradingSystem {

  /**
   * Open the give-item dialog for an item from a source actor.
   * @param {Actor} sourceActor   The actor giving the item.
   * @param {Item}  itemToGive    The item being offered.
   */
  static async openGiveDialog(sourceActor, itemToGive) {
    if (!sourceActor || !itemToGive) return;

    // Find the source actor's token on the active scene.
    const sourceToken = sourceActor.getActiveTokens()[0];
    if (!sourceToken) {
      ui.notifications.warn(`${sourceActor.name} has no token on the current scene.`);
      return;
    }

    const TRADE_RANGE_FT = 10;

    // Build recipient list: characters whose tokens are within range.
    const recipients = [];
    for (const candidate of game.actors) {
      if (candidate.type !== 'character') continue;
      if (candidate.id === sourceActor.id) continue;
      const candToken = candidate.getActiveTokens()[0];
      if (!candToken) continue;
      const dist = this._tokenDistance(sourceToken, candToken);
      if (dist <= TRADE_RANGE_FT) {
        recipients.push({ actor: candidate, distance: dist });
      }
    }

    if (recipients.length === 0) {
      ui.notifications.warn(`No characters within ${TRADE_RANGE_FT}ft to trade with.`);
      return;
    }

    const recipientOptions = recipients.map(r =>
      `<option value="${r.actor.id}">${r.actor.name} (${Math.round(r.distance)}ft)</option>`
    ).join('');

    const maxQty = itemToGive.system.quantity ?? 1;
    const showQuantity = maxQty > 1;
    const quantityRow = showQuantity
      ? `<div class="form-group">
          <label>Quantity</label>
          <input type="number" name="quantity" value="${maxQty}" min="1" max="${maxQty}" />
          <span class="hint">(max ${maxQty})</span>
        </div>`
      : `<input type="hidden" name="quantity" value="1" />`;

    const content = `
      <form class="trade-dialog">
        <div class="form-group">
          <label>Item</label>
          <p><strong>${itemToGive.name}</strong></p>
        </div>
        <div class="form-group">
          <label>Give to</label>
          <select name="recipientId">${recipientOptions}</select>
        </div>
        ${quantityRow}
        <div class="form-group">
          <label>Price (Credits)</label>
          <input type="number" name="price" value="0" min="0" step="1" />
          <span class="hint">(0 = free gift)</span>
        </div>
        <div class="form-group">
          <label>Note (optional)</label>
          <input type="text" name="note" placeholder="e.g. 'For your help'" />
        </div>
      </form>
    `;

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: `Give ${itemToGive.name}` },
      content,
      buttons: [
        {
          action: 'give',
          label: 'Give',
          icon: 'fas fa-handshake',
          default: true,
          callback: (event, button) => {
            const form = button.form ?? button.closest('.dialog-v2')?.querySelector('form');
            if (!form) return null;
            return {
              recipientId: form.querySelector('[name="recipientId"]').value,
              quantity: Math.max(1, Math.min(maxQty, parseInt(form.querySelector('[name="quantity"]').value, 10) || 1)),
              price: Math.max(0, parseInt(form.querySelector('[name="price"]').value, 10) || 0),
              note: form.querySelector('[name="note"]')?.value ?? '',
            };
          },
        },
        { action: 'cancel', label: 'Cancel' },
      ],
      close: () => null,
    });

    if (!result || result === 'cancel') return;

    const recipientEntry = recipients.find(r => r.actor.id === result.recipientId);
    if (!recipientEntry) return;

    // ── Step 2: Optional barter — request items from recipient ──
    let requestedItems = [];
    const recipientItems = recipientEntry.actor.items.filter(i =>
      ['item', 'consumable'].includes(i.type)
    );
    if (recipientItems.length > 0) {
      const askBarter = await foundry.applications.api.DialogV2.confirm({
        window: { title: 'Request items in exchange?' },
        content: `<p>Do you want to request items from ${recipientEntry.actor.name} in exchange?</p>`,
        yes: { label: 'Yes, choose items' },
        no:  { label: 'No, skip' },
      });

      if (askBarter) {
        const itemCheckboxes = recipientItems.map(it =>
          `<label class="form-group" style="display:flex;gap:6px;align-items:center;">
            <input type="checkbox" name="reqItem" value="${it.id}" />
            <span>${it.name} (×${it.system.quantity ?? 1})</span>
          </label>`
        ).join('');

        const barterChoice = await foundry.applications.api.DialogV2.wait({
          window: { title: `Request from ${recipientEntry.actor.name}` },
          content: `<form><div class="barter-list" style="max-height:300px;overflow-y:auto;">${itemCheckboxes}</div></form>`,
          buttons: [
            {
              action: 'request',
              label: 'Confirm Request',
              default: true,
              callback: (event, button) => {
                const form = button.form ?? button.closest('.dialog-v2')?.querySelector('form');
                if (!form) return [];
                return [...form.querySelectorAll('input[name="reqItem"]:checked')].map(cb => cb.value);
              },
            },
            { action: 'cancel', label: 'Cancel' },
          ],
          close: () => null,
        });

        if (barterChoice === 'cancel' || !barterChoice) return;
        requestedItems = barterChoice;
      }
    }

    // ── Step 3: Recipient confirmation if money or barter is involved ──
    const isPaid = result.price > 0;
    const isBarter = requestedItems.length > 0;

    if (isPaid || isBarter) {
      // Affordability check.
      if (isPaid) {
        const recipientCredits = recipientEntry.actor.system.credits ?? 0;
        if (recipientCredits < result.price) {
          ui.notifications.warn(`${recipientEntry.actor.name} only has ${recipientCredits} credits — cannot afford ${result.price}.`);
          return;
        }
      }

      const requestedItemNames = requestedItems
        .map(id => recipientEntry.actor.items.get(id)?.name)
        .filter(Boolean);

      const offerLine = `<p><strong>You receive:</strong> ${result.quantity}× ${itemToGive.name}${isPaid ? ` + ${result.price} credits payment` : ''}</p>`;
      const askLine = isBarter
        ? `<p><strong>You give:</strong> ${requestedItemNames.join(', ')}${isPaid ? ` + ${result.price} credits` : ''}</p>`
        : (isPaid ? `<p><strong>You pay:</strong> ${result.price} credits</p>` : '');
      const noteLine = result.note ? `<p><em>"${result.note}"</em></p>` : '';

      const accepted = await foundry.applications.api.DialogV2.confirm({
        window: { title: `Trade Offer for ${recipientEntry.actor.name}` },
        content: `<p><strong>${sourceActor.name}</strong> proposes a trade.</p>${offerLine}${askLine}${noteLine}<p>Accept?</p>`,
        yes: { label: 'Accept' },
        no:  { label: 'Decline' },
      });

      if (!accepted) {
        ChatMessage.create({
          content: `<p><strong>${recipientEntry.actor.name}</strong> declines ${sourceActor.name}'s trade offer.</p>`,
        });
        return;
      }
    }

    await this.executeTrade({
      sourceActorUuid: sourceActor.uuid,
      itemId: itemToGive.id,
      recipientActorUuid: recipientEntry.actor.uuid,
      quantity: result.quantity,
      price: result.price,
      requestedItemIds: requestedItems,
      note: result.note,
    });
  }

  /**
   * Compute distance between two tokens in scene grid units (feet typically).
   * Uses center-to-center Euclidean distance.
   */
  static _tokenDistance(tokenA, tokenB) {
    const docA = tokenA.document ?? tokenA;
    const docB = tokenB.document ?? tokenB;
    const scene = docA.parent;
    if (!scene) return Infinity;

    const gridSize = scene.grid?.size ?? 100;
    const gridDistance = scene.grid?.distance ?? 5;

    const ax = docA.x + (docA.width * gridSize) / 2;
    const ay = docA.y + (docA.height * gridSize) / 2;
    const bx = docB.x + (docB.width * gridSize) / 2;
    const by = docB.y + (docB.height * gridSize) / 2;

    const pixelDist = Math.hypot(ax - bx, ay - by);
    return (pixelDist / gridSize) * gridDistance;
  }

  /**
   * Execute a trade. Routes through GM if the user lacks permissions.
   */
  static async executeTrade(payload) {
    if (!payload.recipientActorUuid) return;

    // GM can do this directly. Players route through GM action.
    if (game.user.isGM) {
      await this._performTransfer(payload);
    } else {
      await AspectsofPowerItem._gmAction({
        type: 'gmExecuteTrade',
        ...payload,
      });
    }
  }

  /**
   * Actually move the item from source to recipient. GM-only.
   */
  static async _performTransfer({ sourceActorUuid, itemId, recipientActorUuid, quantity, price, requestedItemIds, note }) {
    const sourceActor = await fromUuid(sourceActorUuid);
    const recipientActor = await fromUuid(recipientActorUuid);
    if (!sourceActor || !recipientActor) return;

    const sourceItem = sourceActor.items.get(itemId);
    if (!sourceItem) {
      ui.notifications.warn(`Item not found on ${sourceActor.name}.`);
      return;
    }

    const sourceQty = sourceItem.system.quantity ?? 1;
    const transferQty = Math.max(1, Math.min(sourceQty, quantity || 1));
    const transferPrice = Math.max(0, price || 0);
    const requestedIds = Array.isArray(requestedItemIds) ? requestedItemIds : [];

    // Validate recipient can pay (re-check at GM level in case state changed).
    if (transferPrice > 0) {
      const recipCredits = recipientActor.system.credits ?? 0;
      if (recipCredits < transferPrice) {
        ui.notifications.warn(`${recipientActor.name} cannot afford ${transferPrice} credits.`);
        return;
      }
    }

    // Helper: move one whole item stack from one actor to another.
    const moveItem = async (item, fromActor, toActor) => {
      const itemData = item.toObject();
      delete itemData._id;
      const existing = toActor.items.find(i => i.name === item.name && i.type === item.type);
      if (existing) {
        const newQty = (existing.system.quantity ?? 1) + (item.system.quantity ?? 1);
        await existing.update({ 'system.quantity': newQty });
        await item.delete();
      } else {
        await toActor.createEmbeddedDocuments('Item', [itemData]);
        await item.delete();
      }
    };

    // Source → Recipient (the offered item, with partial quantity support).
    const itemData = sourceItem.toObject();
    itemData.system.quantity = transferQty;
    delete itemData._id;

    const existing = recipientActor.items.find(i =>
      i.name === sourceItem.name && i.type === sourceItem.type
    );
    if (existing) {
      const newQty = (existing.system.quantity ?? 1) + transferQty;
      await existing.update({ 'system.quantity': newQty });
    } else {
      await recipientActor.createEmbeddedDocuments('Item', [itemData]);
    }
    if (sourceQty <= transferQty) {
      await sourceItem.delete();
    } else {
      await sourceItem.update({ 'system.quantity': sourceQty - transferQty });
    }

    // Recipient → Source (barter items, full stacks).
    const movedItemNames = [];
    for (const reqId of requestedIds) {
      const reqItem = recipientActor.items.get(reqId);
      if (!reqItem) continue;
      movedItemNames.push(`${reqItem.system.quantity ?? 1}× ${reqItem.name}`);
      await moveItem(reqItem, recipientActor, sourceActor);
    }

    // Transfer credits.
    if (transferPrice > 0) {
      const recipCredits = recipientActor.system.credits ?? 0;
      const sourceCredits = sourceActor.system.credits ?? 0;
      await recipientActor.update({ 'system.credits': recipCredits - transferPrice });
      await sourceActor.update({ 'system.credits': sourceCredits + transferPrice });
    }

    // Post chat notification.
    const noteLine = note ? `<p><em>"${note}"</em></p>` : '';
    const priceLine = transferPrice > 0
      ? `<p><strong>${recipientActor.name}</strong> paid <strong>${transferPrice} credits</strong>.</p>`
      : '';
    const barterLine = movedItemNames.length
      ? `<p><strong>${recipientActor.name}</strong> gave: ${movedItemNames.join(', ')}.</p>`
      : '';

    const headerLabel = movedItemNames.length ? 'Barter Complete'
                     : transferPrice > 0 ? 'Sale Complete' : 'Trade Complete';

    ChatMessage.create({
      content: `<div class="trade-result">
        <h3>${headerLabel}</h3>
        <hr>
        <p><strong>${sourceActor.name}</strong> gave <strong>${transferQty}× ${sourceItem.name}</strong> to <strong>${recipientActor.name}</strong>.</p>
        ${barterLine}
        ${priceLine}
        ${noteLine}
      </div>`,
    });
  }

  /**
   * Initialize hooks for the trading system.
   */
  static initialize() {
    // Future: socket listener for non-GM-initiated trades requiring confirmation.
  }
}
