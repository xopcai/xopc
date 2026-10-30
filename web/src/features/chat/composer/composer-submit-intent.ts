/** All primary submit surfaces use the same precedence, independent of queue length. */
export function composerSubmitIntent(state: { editingUserTurnId?: string | null; editingFollowUpId?: string | null; runBusy: boolean; blocked?: boolean; queuePaused?: boolean }) {
  if (state.blocked || (state.editingUserTurnId || state.editingFollowUpId) && state.queuePaused === false) return 'blocked';
  if (state.editingFollowUpId) return 'saveFollowUp';
  if (state.editingUserTurnId) return state.runBusy ? 'blocked' : 'replaceTurn';
  return state.runBusy ? 'queue' : 'send';
}
