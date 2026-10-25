using System;
using System.Drawing;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public class XopcInputFixture : Form {
  readonly TextBox message = new TextBox();
  readonly TextBox protectedInput = new TextBox();
  readonly TextBox readOnlyInput = new TextBox();
  readonly Label result = new Label();
  readonly Label keyboard = new Label();
  readonly string output;
  string lastKey = "";
  int verifyClicks = 0;
  const string Expected = "Windows 输入验证 OK";
  public XopcInputFixture(string outputPath) {
    output = outputPath;
    Text = "XOPC disposable input validation";
    ClientSize = new Size(740, 420);
    StartPosition = FormStartPosition.CenterScreen;
    Font = new Font("Segoe UI", 12);
    AddLabel("Disposable Windows input test. Use Message, then Verify.", 22, 18, 700);
    AddLabel("Message", 22, 65, 650);
    message.SetBounds(22, 97, 680, 90); message.Multiline = true;
    message.AccessibleName = "Message"; message.Name = "Message"; message.TabIndex = 0;
    message.TextChanged += (s,e) => Save();
    message.KeyUp += (s,e) => { lastKey = e.KeyCode.ToString(); keyboard.Text = "Keyboard: " + lastKey; Save(); };
    Controls.Add(message);
    AddLabel("Protected input (manual only)", 22, 198, 320);
    protectedInput.SetBounds(22, 230, 320, 30); protectedInput.UseSystemPasswordChar = true;
    protectedInput.AccessibleName = "Protected input"; protectedInput.TabIndex = 1; Controls.Add(protectedInput);
    AddLabel("Read only", 375, 198, 325);
    readOnlyInput.SetBounds(375, 230, 327, 30); readOnlyInput.ReadOnly = true;
    readOnlyInput.Text = "READ ONLY"; readOnlyInput.AccessibleName = "Read only"; Controls.Add(readOnlyInput);
    var verify = new Button(); verify.SetBounds(22, 285, 170, 42); verify.Text = "Verify";
    verify.AccessibleName = "Verify"; verify.Click += (s,e) => {
      verifyClicks++; result.Text = message.Text == Expected && lastKey == "End" ? "PASS: Windows input verified" : "FAIL: Check Message and End key"; Save();
    }; Controls.Add(verify);
    keyboard.SetBounds(230, 292, 470, 35); keyboard.Text = "Keyboard: none"; Controls.Add(keyboard);
    result.SetBounds(22, 345, 680, 48); result.Text = "Waiting for Message"; Controls.Add(result);
    // Read the app-owned control state independently of UIA acknowledgements
    // and TextChanged notifications (some ValuePattern providers omit those).
    var oracleTimer = new Timer(); oracleTimer.Interval = 200; oracleTimer.Tick += (s,e) => Save(); oracleTimer.Start();
    Shown += (s,e) => { message.Focus(); Save(); };
  }
  void AddLabel(string text, int x, int y, int width) {
    var label = new Label(); label.SetBounds(x, y, width, 28); label.Text = text; Controls.Add(label);
  }
  void Save() {
    if (String.IsNullOrEmpty(output)) return;
    var data = new { text = message.Text, lastKey = lastKey, verifyClicks = verifyClicks,
      validated = message.Text == Expected && lastKey == "End" && verifyClicks > 0, protectedLength = protectedInput.Text.Length,
      readOnlyText = readOnlyInput.Text, pid = System.Diagnostics.Process.GetCurrentProcess().Id };
    var temporary = output + ".tmp";
    File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(data), new System.Text.UTF8Encoding(false));
    if (File.Exists(output)) File.Replace(temporary, output, null); else File.Move(temporary, output);
  }
  [STAThread] public static void Main(string[] args) {
    Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
    Application.Run(new XopcInputFixture(args[0]));
  }
}
