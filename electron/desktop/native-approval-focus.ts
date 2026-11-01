/** Main-only recognition of an application-owned native sheet; never a foreground grant supplied by IPC. */
export class DesktopNativeApprovalFocus {
  private pending?: { parent: object; generation: number; signal: AbortSignal };
  begin(parent: object, generation: number, signal: AbortSignal) {
    if (this.pending && !this.pending.signal.aborted) throw new Error('DESKTOP_NATIVE_APPROVAL_BUSY');
    signal.throwIfAborted();
    const pending = { parent, generation, signal }; this.pending = pending;
    return () => { if (this.pending === pending) this.pending = undefined; };
  }
  focused(parent: object | undefined, generation: number, applicationActive: boolean, parentVisible: boolean) {
    const pending = this.pending;
    return Boolean(applicationActive && parentVisible && pending && !pending.signal.aborted && pending.parent === parent && pending.generation === generation);
  }
}
