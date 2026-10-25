using System;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Threading;

public class XopcWpfFixture : Window {
  readonly TextBox message = new TextBox();
  readonly PasswordBox password = new PasswordBox();
  readonly TextBox readOnly = new TextBox();
  readonly TextBlock keyboard = new TextBlock();
  readonly TextBlock result = new TextBlock();
  readonly string output;
  string lastKey = ""; int clicks = 0;
  public XopcWpfFixture(string path) {
    output = path; Title = "XOPC disposable WPF validation"; Width = 740; Height = 480;
    WindowStartupLocation = WindowStartupLocation.CenterScreen;
    var stack = new StackPanel { Margin = new Thickness(22) }; Content = stack;
    stack.Children.Add(new TextBlock { Text = "Disposable WPF input validation", FontSize = 20 });
    stack.Children.Add(new TextBlock { Text = "Message", Margin = new Thickness(0, 15, 0, 4) });
    message.Height = 85; message.AcceptsReturn = true; AutomationProperties.SetName(message, "Message"); stack.Children.Add(message);
    message.TextChanged += (s,e) => Save(); message.KeyUp += (s,e) => { lastKey = e.Key.ToString(); keyboard.Text = "Keyboard: " + lastKey; Save(); };
    stack.Children.Add(new TextBlock { Text = "Protected input", Margin = new Thickness(0, 12, 0, 4) });
    AutomationProperties.SetName(password, "Protected input"); password.Height = 26; stack.Children.Add(password);
    stack.Children.Add(new TextBlock { Text = "Read only", Margin = new Thickness(0, 12, 0, 4) });
    readOnly.Text = "READ ONLY"; readOnly.IsReadOnly = true; readOnly.Height = 26; AutomationProperties.SetName(readOnly, "Read only"); stack.Children.Add(readOnly);
    var verify = new Button { Content = "Verify", Width = 150, Height = 36, Margin = new Thickness(0, 15, 0, 4), HorizontalAlignment = HorizontalAlignment.Left };
    AutomationProperties.SetName(verify, "Verify"); verify.Click += (s,e) => { clicks++; result.Text = message.Text == "Windows 输入验证 OK" && lastKey == "End" ? "PASS: Windows input verified" : "FAIL"; Save(); };
    stack.Children.Add(verify); keyboard.Text = "Keyboard: none"; stack.Children.Add(keyboard); result.Text = "Waiting for Message"; stack.Children.Add(result);
    var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(200) }; timer.Tick += (s,e) => Save(); timer.Start();
    Loaded += (s,e) => { message.Focus(); Save(); };
  }
  void Save() {
    if (String.IsNullOrEmpty(output)) return;
    var state = new { text = message.Text, lastKey = lastKey, verifyClicks = clicks,
      validated = message.Text == "Windows 输入验证 OK" && lastKey == "End" && clicks > 0,
      protectedLength = password.Password.Length, readOnlyText = readOnly.Text, pid = System.Diagnostics.Process.GetCurrentProcess().Id };
    var temporary = output + ".tmp"; File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(state), new UTF8Encoding(false));
    if (File.Exists(output)) File.Replace(temporary, output, null); else File.Move(temporary, output);
  }
  [STAThread] public static void Main(string[] args) { new Application().Run(new XopcWpfFixture(args[0])); }
}
