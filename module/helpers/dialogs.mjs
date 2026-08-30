/**
 * Dialog plumbing shared by the roll-path prompts.
 *
 * WHY THIS EXISTS (2026-08-30, John's Blazing Greatsword loop at the
 * table): core v14's `DialogV2._onSubmit` resolves
 * `callback() ?? button.action` - a button callback that deliberately
 * returns null (this system's cancel idiom, `callback: () => null`) is
 * silently replaced by the button's action STRING. 'cancel' is truthy,
 * so every `=== null` / `!result` guard downstream let a cancelled
 * dialog through as a live value: a cancelled invest dialog DECLARED
 * the cast with investedAmount 'cancel', and a cancelled curse-transfer
 * picker fell back to transferring the first curse. The same
 * substitution bites a CONFIRM callback that returns null to mean "no
 * valid selection" (dismember's empty slot, the legal-targets filter).
 */

/**
 * `DialogV2.wait` with null-returning callbacks restored: a result that
 * is exactly one of the config's button action strings is mapped back to
 * null. Unambiguous for every prompt routed here - their value callbacks
 * return numbers, objects, arrays, or element values, never bare action
 * ids. Dialogs that WANT the action-string result (the bare
 * `{action: 'cancel'}` idiom checked with `result === 'cancel'`) should
 * keep calling `DialogV2.wait` directly.
 */
export async function dialogWaitNull(config) {
  const result = await foundry.applications.api.DialogV2.wait(config);
  const actions = (config.buttons ?? []).map(b => b?.action);
  return (typeof result === 'string' && actions.includes(result)) ? null : result;
}
