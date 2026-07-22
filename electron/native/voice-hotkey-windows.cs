using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

internal static class VoiceHotkeyHelper
{
    private const int WhKeyboardLl = 13;
    private const int WmKeyDown = 0x0100;
    private const int WmKeyUp = 0x0101;
    private const int WmSysKeyDown = 0x0104;
    private const int WmSysKeyUp = 0x0105;
    private const int VkControl = 0x11;
    private const int VkShift = 0x10;
    private const int VkMenu = 0x12;
    private const int VkLMenu = 0xA4;
    private const int VkRMenu = 0xA5;
    private const int VkLWin = 0x5B;
    private const int VkRWin = 0x5C;
    private const int HoldDelayMs = 300;

    private static readonly LowLevelKeyboardProc HookProc = OnKeyboardEvent;
    private static IntPtr hook = IntPtr.Zero;
    private static bool altIsDown;
    private static bool chorded;
    private static bool holdTriggered;
    private static Timer holdTimer;

    public static void Main()
    {
        using (Process process = Process.GetCurrentProcess())
        using (ProcessModule module = process.MainModule)
        {
            hook = SetWindowsHookEx(WhKeyboardLl, HookProc, GetModuleHandle(module.ModuleName), 0);
        }
        if (hook == IntPtr.Zero)
        {
            Environment.Exit(2);
        }

        MSG message;
        while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
        UnhookWindowsHookEx(hook);
    }

    private static IntPtr OnKeyboardEvent(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            int kind = message.ToInt32();
            bool isDown = kind == WmKeyDown || kind == WmSysKeyDown;
            bool isUp = kind == WmKeyUp || kind == WmSysKeyUp;
            uint key = (uint)Marshal.ReadInt32(data);
            bool isAlt = key == VkMenu || key == VkLMenu || key == VkRMenu;

            if (isDown && isAlt)
            {
                if (!altIsDown)
                {
                    altIsDown = true;
                    chorded = IsModifierDown(VkControl) || IsModifierDown(VkShift) ||
                        IsModifierDown(VkLWin) || IsModifierDown(VkRWin);
                    holdTriggered = false;
                    holdTimer = new Timer(OnHoldElapsed, null, HoldDelayMs, Timeout.Infinite);
                }
            }
            else if (isDown && altIsDown)
            {
                chorded = true;
                DisposeHoldTimer();
            }
            else if (isUp && isAlt && altIsDown)
            {
                DisposeHoldTimer();
                if (holdTriggered) Emit("release");
                altIsDown = false;
                chorded = false;
                holdTriggered = false;
            }
        }

        return CallNextHookEx(hook, code, message, data);
    }

    private static void OnHoldElapsed(object _)
    {
        if (!altIsDown || chorded) return;
        holdTriggered = true;
        Emit("press");
    }

    private static bool IsModifierDown(int key)
    {
        return (GetAsyncKeyState(key) & 0x8000) != 0;
    }

    private static void DisposeHoldTimer()
    {
        Timer timer = holdTimer;
        holdTimer = null;
        if (timer != null) timer.Dispose();
    }

    private static void Emit(string action)
    {
        Console.WriteLine("{\"type\":\"modifier-hold\",\"action\":\"" + action + "\",\"key\":\"alt\"}");
        Console.Out.Flush();
    }

    private delegate IntPtr LowLevelKeyboardProc(int code, IntPtr message, IntPtr data);

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT point;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int hookId, LowLevelKeyboardProc callback, IntPtr module, uint threadId);

    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(IntPtr hookHandle);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hookHandle, int code, IntPtr message, IntPtr data);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG message, IntPtr window, uint min, uint max);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG message);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG message);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string moduleName);
}
