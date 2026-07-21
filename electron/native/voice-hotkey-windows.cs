using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

internal static class VoiceHotkeyHelper
{
    private const int WhKeyboardLl = 13;
    private const int WmKeyDown = 0x0100;
    private const int WmKeyUp = 0x0101;
    private const int WmSysKeyDown = 0x0104;
    private const int WmSysKeyUp = 0x0105;
    private const int VkControl = 0x11;
    private const int VkMenu = 0x12;
    private const int VkLMenu = 0xA4;
    private const int VkRMenu = 0xA5;

    private static readonly LowLevelKeyboardProc HookProc = OnKeyboardEvent;
    private static IntPtr hook = IntPtr.Zero;
    private static bool altIsDown;
    private static bool chorded;

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
                    chorded = (GetAsyncKeyState(VkControl) & 0x8000) != 0;
                }
                else
                {
                    chorded = true;
                }
            }
            else if (isDown && altIsDown)
            {
                chorded = true;
            }
            else if (isUp && isAlt && altIsDown)
            {
                if (!chorded)
                {
                    Console.WriteLine("{\"type\":\"modifier-tap\",\"key\":\"alt\"}");
                    Console.Out.Flush();
                }
                altIsDown = false;
                chorded = false;
            }
        }

        return CallNextHookEx(hook, code, message, data);
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
