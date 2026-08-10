/**
 * Token-HUD controls for a deployed deployable (a placed pylon).
 *
 * Two buttons, both only shown on a token that is actually a deployment:
 *   Recover      — take it back. Owner-only, enforced in the subsystem.
 *   Install aura — a Leadership commander pushes one of their auras into it,
 *                  which the pylon then projects in their stead.
 *
 * The HUD is the right home for these: a deployed pylon is a thing on the map
 * you point at, not a row in somebody's inventory. The item sheet keeps the
 * deploy half, because at that moment the item IS in an inventory.
 */

import { installAuraInPylon, recoverDeployable, uninstallAuraFromPylon } from '../systems/deployable.mjs';

/** The deployed item a token stands in for, if any. */
function _deployedItemOf(actor) {
  return actor?.items?.find(i => i.system?.deployedTokenUuid) ?? null;
}

/**
 * Aura skills the user could install: owned by a character they control that
 * carries `leadership`, and actually projecting something.
 */
function _installableAuras() {
  const out = [];
  for (const actor of game.actors) {
    if (!actor.isOwner || !actor.hasTag?.('leadership')) continue;
    for (const skill of actor.items) {
      if (skill.type !== 'skill') continue;
      if (!((skill.system?.tagConfig?.auraRadius ?? 0) > 0)) continue;
      out.push({ actor, skill });
    }
  }
  return out;
}

async function _promptInstall(tokenDoc) {
  const pylon = tokenDoc.actor;
  const installed = pylon.items.filter(i => i.flags?.['aspects-of-power']?.installedBy);
  const options = _installableAuras()
    .filter(({ skill }) => !installed.some(i => i.name === skill.name));

  if (!options.length && !installed.length) {
    return void ui.notifications.warn(
      'No installable auras. An aura must be owned by a Leadership character you control and have a radius.');
  }

  const rows = options.map((o, i) =>
    `<option value="${i}">${o.skill.name} — ${o.actor.name}</option>`).join('');
  const installedRows = installed.map(i =>
    `<li>${i.name} <a class="aop-uninstall" data-name="${i.name}">(remove)</a></li>`).join('');

  const content = `
    ${installed.length ? `<p><strong>Installed:</strong></p><ul>${installedRows}</ul>` : ''}
    ${options.length ? `<p><label>Install an aura:</label>
      <select name="aura" style="width:100%">${rows}</select></p>`
      : '<p><em>Nothing further to install.</em></p>'}`;

  const DialogV2 = foundry.applications.api.DialogV2;
  await DialogV2.wait({
    window: { title: `${tokenDoc.name}` },
    content,
    buttons: [
      {
        action: 'install', label: 'Install', default: true,
        callback: async (_ev, btn) => {
          const idx = Number(btn.form?.elements?.aura?.value);
          const pick = options[idx];
          if (pick) await installAuraInPylon(pick.actor, tokenDoc, pick.skill);
        },
      },
      { action: 'close', label: 'Close' },
    ],
    render: (_ev, dialog) => {
      const root = dialog?.element ?? dialog;
      for (const a of root?.querySelectorAll?.('.aop-uninstall') ?? []) {
        a.addEventListener('click', async () => {
          // Whoever installed it is the only one who may pull it out; the
          // subsystem re-checks, this just picks a plausible claimant.
          const item = installed.find(i => i.name === a.dataset.name);
          const claimant = await fromUuid(item?.flags?.['aspects-of-power']?.installedBy);
          await uninstallAuraFromPylon(claimant, tokenDoc, a.dataset.name);
          root?.close?.();
        });
      }
    },
  }).catch(() => null);
}

export function registerDeployableHud() {
  Hooks.on('renderTokenHUD', (hud, html) => {
    const tokenDoc = hud.object?.document;
    const actor = tokenDoc?.actor;
    const deployed = _deployedItemOf(actor);
    if (!deployed) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    const col = root?.querySelector('.col.right') ?? root?.querySelector('.col.left');
    if (!col) return;

    const add = (icon, tooltip, handler) => {
      const div = document.createElement('div');
      div.className = 'control-icon';
      div.dataset.tooltip = tooltip;
      div.innerHTML = `<i class="fas ${icon}"></i>`;
      div.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await handler();
        hud.clear();
      });
      col.appendChild(div);
    };

    add('fa-tower-broadcast', `Install an aura into ${deployed.name}`,
      () => _promptInstall(tokenDoc));

    // Only offer Recover to the owner — the subsystem refuses anyone else, but
    // a button that always fails is worse than no button.
    const ownerUuid = deployed.system.deployOwnerUuid;
    const iAmOwner = game.actors.some(a => a.uuid === ownerUuid && a.isOwner);
    if (iAmOwner) {
      add('fa-hand-back-fist', `Recover ${deployed.name}`, async () => {
        const owner = await fromUuid(ownerUuid);
        await recoverDeployable(owner, tokenDoc);
      });
    }
  });
}
