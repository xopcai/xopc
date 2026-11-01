import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import { z } from 'zod';
import { WindowsNativeReader } from './windows-reader.js';

// Read native identity and input safety only; never return field values.
const declarations = `
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class XopcComputerIdentity {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwnd, EnumProc callback, IntPtr param);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern int GetApplicationUserModelId(IntPtr process, ref uint length, StringBuilder id);
  public static string[] AppIds(IntPtr hwnd) {
    var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    Action<IntPtr> read = w => {
      uint pid; GetWindowThreadProcessId(w, out pid);
      var handle = OpenProcess(0x1000, false, pid);
      if (handle == IntPtr.Zero) throw new Exception("process identity unavailable");
      try { uint length = 0; var status = GetApplicationUserModelId(handle, ref length, null);
        if (status == 122) { var id = new StringBuilder((int)length);
          if (GetApplicationUserModelId(handle, ref length, id) != 0) throw new Exception("app identity unavailable");
          ids.Add(id.ToString());
        } else if (status != 15703) throw new Exception("app identity unavailable");
      } finally { CloseHandle(handle); }
    };
    read(hwnd); EnumChildWindows(hwnd, (w,p) => { read(w); return true; }, IntPtr.Zero);
    var result = new string[ids.Count]; ids.CopyTo(result); return result;
  }
}`;

const inputDeclarations = `
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Automation;
public class XopcInputField {
  public string runtimeId;
  public string parentRuntimeId;
  public string label;
  public string role;
  public bool? password;
  public bool enabled;
  public bool writable;
  public bool offscreen;
  public double x, y, w, h;
}
public class XopcInputState {
  public XopcInputField[] fields;
  public XopcInputField focused;
}
public class XopcComputerInput {
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
  [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent, IntPtr child);
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] struct GuiThreadInfo {
    public uint size, flags;
    public IntPtr active, focus, capture, menuOwner, moveSize, caret;
    public Rect caretRect;
  }
  static XopcInputField Read(AutomationElement e) {
    object password = e.GetCurrentPropertyValue(AutomationElement.IsPasswordProperty, true);
    var c = e.Current; var rect = c.BoundingRectangle;
    object pattern; bool hasValue = e.TryGetCurrentPattern(ValuePattern.Pattern, out pattern);
    bool writable = hasValue && !((ValuePattern)pattern).Current.IsReadOnly;
    if (!hasValue && e.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) {
      object readOnly = ((TextPattern)pattern).DocumentRange.GetAttributeValue(TextPattern.IsReadOnlyAttribute);
      writable = readOnly is bool && !(bool)readOnly;
    }
    var parent = TreeWalker.RawViewWalker.GetParent(e);
    return new XopcInputField { runtimeId = String.Join(",", e.GetRuntimeId()),
      parentRuntimeId = parent == null ? null : String.Join(",", parent.GetRuntimeId()),
      label = c.Name,
      role = c.ControlType.ProgrammaticName, password = password is bool ? (bool?)password : null,
      enabled = c.IsEnabled, writable = writable, offscreen = c.IsOffscreen,
      x = rect.X, y = rect.Y, w = rect.Width, h = rect.Height };
  }
  public static XopcInputState ReadWindow(IntPtr hwnd) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    var root = AutomationElement.FromHandle(hwnd);
    if (root == null) throw new Exception("window unavailable");
    var condition = new OrCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
      new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document));
    var found = root.FindAll(TreeScope.Descendants, condition);
    if (found.Count > 180) throw new Exception("input metadata limit");
    var fields = new List<XopcInputField>();
    for (int i = 0; i < found.Count; i++) fields.Add(Read(found[i]));
    XopcInputField focused = null;
    var element = AutomationElement.FocusedElement;
    var ancestor = element;
    for (int depth = 0; ancestor != null && depth < 64; depth++) {
      if (Automation.Compare(root, ancestor)) { focused = Read(element); break; }
      ancestor = TreeWalker.RawViewWalker.GetParent(ancestor);
    }
    if (focused == null) {
      uint pid; var thread = GetWindowThreadProcessId(hwnd, out pid);
      var info = new GuiThreadInfo(); info.size = (uint)Marshal.SizeOf(info);
      if (GetGUIThreadInfo(thread, ref info) && info.focus != IntPtr.Zero
        && (info.focus == hwnd || IsChild(hwnd, info.focus))) focused = Read(AutomationElement.FromHandle(info.focus));
    }
    return new XopcInputState { fields = fields.ToArray(), focused = focused };
  }
}`;

export interface WindowsInputField {
  runtimeId: string; role: string; password: boolean | null; enabled: boolean; writable: boolean; offscreen: boolean;
  parentRuntimeId?: string | null;
  label?: string;
  x: number; y: number; w: number; h: number;
}
export interface WindowsInputState { fields: WindowsInputField[]; focused: WindowsInputField | null }
const InputField = z.object({ runtimeId: z.string().min(1).max(512), role: z.string().min(1).max(80),
  parentRuntimeId: z.string().min(1).max(512).nullish(),
  label: z.string().max(16384).optional(),
  password: z.boolean().nullable(), enabled: z.boolean(), writable: z.boolean(), offscreen: z.boolean(),
  x: z.number().finite(), y: z.number().finite(), w: z.number().finite().nonnegative(), h: z.number().finite().nonnegative() });
const InputState = z.object({ fields: z.array(InputField).max(180), focused: InputField.nullable() });

export interface WindowsComputerIdentity { processIdentity: string; executable: string; appIds: string[]; sessionId: number; input?: WindowsInputState }

const readerScript = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8;
Add-Type -TypeDefinition @'
${declarations}
'@;
Add-Type -ReferencedAssemblies UIAutomationClient,UIAutomationTypes,WindowsBase -TypeDefinition @'
${inputDeclarations}
'@;
while ($null -ne ($line=[Console]::ReadLine())) {
  try {
    $request=ConvertFrom-Json $line;
    $p=Get-Process -Id $request.pid; $current=Get-Process -Id $PID;
    if ($p.SessionId -eq 0 -or $p.SessionId -ne $current.SessionId) { throw 'interactive session required' };
    $appIds=@(); $inputState=$null;
    if ($request.windowId) {
      $owner=[uint32]0; $hwnd=[IntPtr]::new([long]$request.windowId);
      [void][XopcComputerIdentity]::GetWindowThreadProcessId($hwnd,[ref]$owner);
      if ($owner -ne $request.pid) { throw 'window owner changed' };
      $appIds=@([XopcComputerIdentity]::AppIds($hwnd));
      if ($request.includeInput) { $inputState=[XopcComputerInput]::ReadWindow($hwnd); };
    };
    $result=@{start=$p.StartTime.ToUniversalTime().Ticks.ToString(); executable=$p.Path; appIds=$appIds; sessionId=$p.SessionId; input=$inputState};
    [Console]::WriteLine(($result | ConvertTo-Json -Depth 6 -Compress));
  } catch { [Console]::WriteLine('{"error":true}'); }
}`;
const defaultOwner = {};
const readers = new WeakMap<object, WindowsNativeReader>();
async function readIdentity(pid: number, windowId?: string, signal?: AbortSignal, includeInput = false, owner: object = defaultOwner): Promise<WindowsComputerIdentity> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || (windowId != null && !/^\d{1,19}$/.test(windowId))) throw new Error('COMPUTER_INVALID_NATIVE_TARGET');
  try {
    let reader = readers.get(owner);
    if (!reader) { reader = new WindowsNativeReader(readerScript); readers.set(owner, reader); }
    const data = await reader.read({ pid, windowId, includeInput }, signal) as Record<string, any>;
    signal?.throwIfAborted();
    if (!/^\d+$/.test(data.start) || typeof data.executable !== 'string' || !win32.isAbsolute(data.executable)
      || !Number.isInteger(data.sessionId) || !Array.isArray(data.appIds) || !data.appIds.every((id: unknown) => typeof id === 'string')) throw new Error();
    return { processIdentity: `${pid}:${createHash('sha256').update(`${data.start}:${data.executable.toLowerCase()}`).digest('hex')}`,
      executable: data.executable, appIds: data.appIds, sessionId: data.sessionId,
      ...(includeInput && data.input ? { input: InputState.parse(data.input) as WindowsInputState } : {}) };
  } catch (error) {
    signal?.throwIfAborted();
    throw new Error('COMPUTER_NATIVE_IDENTITY_UNAVAILABLE', { cause: error });
  }
}
export const readWindowsComputerIdentity = Object.assign(readIdentity, {
  close(owner: object = defaultOwner) { readers.get(owner)?.dispose(); readers.delete(owner); },
});
