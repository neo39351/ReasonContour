using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program {
    [STAThread] static void Main(string[] args) {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var applicationMutex = new System.Threading.Mutex(false, @"Local\ReasonContour.Desktop")) {
            Application.Run(new CanvasWindow(Array.IndexOf(args, "--self-test") >= 0));
        }
    }
}
internal sealed class CanvasWindow : Form {
    readonly string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
    readonly bool test;
    WebView2 web;
    Process server;
    NotifyIcon tray;
    ContextMenuStrip trayMenu;
    bool chinese;
    bool dark;
    bool stopping;
    string nodePath;
    string dataPath;
    bool Installed { get { return File.Exists(Path.Combine(root, "installed.json")); } }
    string UserRoot { get { return Installed ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ReasonContour") : root; } }
    FormWindowState restoredState = FormWindowState.Normal;
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr handle, int attribute, ref int value, int size);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr handle, int attribute, out int value, int size);
    public CanvasWindow(bool selfTest) {
        test = selfTest;
        Text = "ReasonContour";
        // Read our embedded bytes directly; Shell icon extraction can return an old cached mark.
        using (var iconStream = typeof(CanvasWindow).Assembly.GetManifestResourceStream("ReasonContour.Icon")) {
            if (iconStream == null) throw new InvalidOperationException("The application icon is missing.");
            using (var embeddedIcon = new Icon(iconStream)) Icon = (Icon)embeddedIcon.Clone();
        }
        float scale;
        using (Graphics graphics = Graphics.FromHwnd(IntPtr.Zero)) scale = graphics.DpiX / 96f;
        Rectangle work = Screen.PrimaryScreen.WorkingArea;
        ClientSize = new Size(Math.Min((int)(1440 * scale), (int)(work.Width * .92)), Math.Min((int)(940 * scale), (int)(work.Height * .88)));
        // Keep half-screen snapping available, including on high-DPI laptop displays.
        MinimumSize = new Size(Math.Min((int)(420 * scale), work.Width / 2), Math.Min((int)(320 * scale), work.Height / 2));
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(245, 242, 236);
        if (test) { ShowInTaskbar = false; Opacity = 0; }
        trayMenu = new ContextMenuStrip();
        trayMenu.Items.Add("Open ReasonContour", null, (sender, e) => RestoreWindow());
        trayMenu.Items.Add("Minimize to tray", null, (sender, e) => HideWindow());
        trayMenu.Items.Add(new ToolStripSeparator());
        trayMenu.Items.Add("Quit", null, (sender, e) => Close());
        tray = new NotifyIcon { Icon = Icon, Text = "ReasonContour", ContextMenuStrip = trayMenu, Visible = !test };
        tray.DoubleClick += (sender, e) => RestoreWindow();
        Resize += (sender, e) => {
            if (WindowState != FormWindowState.Minimized) {
                restoredState = WindowState;
                ApplyTitleBarTheme();
            }
        };
        Shown += async (sender, e) => await Start();
        FormClosed += (sender, e) => Stop();
    }
    void HideWindow() { Hide(); ShowInTaskbar = false; trayMenu.Items[1].Enabled = false; }
    void RestoreWindow() { var targetState = restoredState; ShowInTaskbar = !test; Show(); WindowState = targetState; ApplyTitleBarTheme(); Activate(); trayMenu.Items[1].Enabled = true; }
    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        ApplyTitleBarTheme();
    }
    protected override void OnActivated(EventArgs e) {
        base.OnActivated(e);
        ApplyTitleBarTheme();
    }
    void ApplyTitleBarTheme() {
        if (!IsHandleCreated || IsDisposed) return;
        int value = dark ? 1 : 0;
        try {
            if (DwmSetWindowAttribute(Handle, 20, ref value, sizeof(int)) != 0)
                DwmSetWindowAttribute(Handle, 19, ref value, sizeof(int));
        } catch (DllNotFoundException) {} catch (EntryPointNotFoundException) {}
    }
    void HostAppearance(string json) {
        try {
            var message = new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, object>>(json);
            if (!message.ContainsKey("type") || (string)message["type"] != "appearance") return;
            chinese = message.ContainsKey("language") && (string)message["language"] == "zh-CN";
            trayMenu.Items[0].Text = chinese ? "打开 ReasonContour" : "Open ReasonContour";
            trayMenu.Items[1].Text = chinese ? "最小化到托盘" : "Minimize to tray";
            trayMenu.Items[3].Text = chinese ? "退出" : "Quit";
            dark = message.ContainsKey("theme") && (string)message["theme"] == "dark";
            BackColor = dark ? Color.FromArgb(30,29,27) : Color.FromArgb(245,242,236);
            if (web != null) web.DefaultBackgroundColor = BackColor;
            ApplyTitleBarTheme();
        } catch (ArgumentException) { /* Ignore malformed presentation messages. */ }
    }
    async Task Start() {
        try {
            string node = Environment.GetEnvironmentVariable("REASONCONTOUR_NODE");
            if (String.IsNullOrEmpty(node) && File.Exists(Path.Combine(root, "runtime", "node.exe"))) node = Path.Combine(root, "runtime", "node.exe");
            if (String.IsNullOrEmpty(node)) { foreach (string folder in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)) { string candidate = Path.Combine(folder.Trim('"'), "node.exe"); if (File.Exists(candidate)) { node = candidate; break; } } }
            if (!File.Exists(node)) throw new Exception("Node.js was not found. Add it to PATH or set REASONCONTOUR_NODE to node.exe.");
            string data = test ? Path.Combine(root, ".test-data", "desktop-data") : (Environment.GetEnvironmentVariable("REASONCONTOUR_DATA_DIR") ?? Path.Combine(UserRoot, "projects"));
            nodePath = node;
            dataPath = data;
            Directory.CreateDirectory(data);
            var start = new ProcessStartInfo(node, "\"" + Path.Combine(root, "app\\server.mjs") + "\"");
            start.WorkingDirectory = root; start.UseShellExecute = false; start.CreateNoWindow = true;
            start.RedirectStandardOutput = true; start.RedirectStandardError = true; start.RedirectStandardInput = true;
            start.EnvironmentVariables["REASONCONTOUR_DATA_DIR"] = data;
            start.EnvironmentVariables["REASONCONTOUR_PORT"] = "0";
            server = Process.Start(start);
            var read = server.StandardOutput.ReadLineAsync();
            if (await Task.WhenAny(read, Task.Delay(20000)) != read) throw new Exception("Local service startup timed out.");
            string line = await read;
            if (String.IsNullOrEmpty(line)) throw new Exception("Local service did not start: " + await server.StandardError.ReadToEndAsync());
            var info = new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, object>>(line);
            string address = (string)info["url"];
            server.BeginErrorReadLine();
            web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
            Controls.Add(web);
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(test ? root : UserRoot, test ? ".test-data" : ".runtime", "desktop-profile"));
            await web.EnsureCoreWebView2Async(environment);
            web.CoreWebView2.WebMessageReceived += (s, e) => HostAppearance(e.WebMessageAsJson);
            web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            web.CoreWebView2.Settings.IsZoomControlEnabled = false;
            web.CoreWebView2.NewWindowRequested += (s, e) => {
                e.Handled = true;
                Uri destination;
                if (Uri.TryCreate(e.Uri, UriKind.Absolute, out destination) && (destination.Scheme == "http" || destination.Scheme == "https")) Process.Start(new ProcessStartInfo(destination.AbsoluteUri) { UseShellExecute = true });
            };
            web.CoreWebView2.NavigationStarting += (s, e) => { if (!e.Uri.StartsWith(address + "/", StringComparison.Ordinal) && e.Uri != address) e.Cancel = true; };
            web.CoreWebView2.Navigate(address);
            if (test) await SelfTest(address);
        } catch (Exception error) {
            if (test) { Directory.CreateDirectory(Path.Combine(root,".test-data")); File.WriteAllText(Path.Combine(root, ".test-data\\desktop-test-error.txt"), error.ToString()); Environment.ExitCode = 1; Close(); }
            else { MessageBox.Show(this, error.Message, "ReasonContour could not open", MessageBoxButtons.OK, MessageBoxIcon.Error); Close(); }
        }
    }
    async Task SelfTest(string address) {
        bool ready = false;
        for (int i = 0; i < 100; i++) {
            await Task.Delay(150);
            if (await web.CoreWebView2.ExecuteScriptAsync("Boolean(document.querySelector('.topbar'))") == "true") { ready = true; break; }
        }
        if (!ready) throw new Exception("The desktop toolbar did not render.");
        Rectangle previousBounds = Bounds;
        Rectangle work = Screen.FromControl(this).WorkingArea;
        Bounds = new Rectangle(work.Left, work.Top, work.Width / 2, work.Height);
        await Task.Delay(150);
        if (Width > work.Width / 2 || Height > work.Height) throw new Exception("Window minimum size prevents half-screen placement.");
        Bounds = previousBounds;
        HostAppearance("{\"type\":\"appearance\",\"theme\":\"dark\",\"language\":\"zh-CN\"}");
        AssertTitleBarTheme(true);
        ShowInTaskbar = true;
        WindowState = FormWindowState.Minimized;
        await Task.Delay(150);
        if (!Visible || !ShowInTaskbar || WindowState != FormWindowState.Minimized) throw new Exception("Ordinary minimize must remain on the taskbar.");
        WindowState = FormWindowState.Normal;
        await Task.Delay(150);
        AssertTitleBarTheme(true);
        trayMenu.Items[1].PerformClick();
        if (Visible || ShowInTaskbar) throw new Exception("Tray minimize failed.");
        trayMenu.Items[0].PerformClick();
        if (!Visible || WindowState == FormWindowState.Minimized) throw new Exception("Tray restore failed.");
        AssertTitleBarTheme(true);
        // Exercise the handle recreation used by taskbar visibility changes.
        ShowInTaskbar = true;
        AssertTitleBarTheme(true);
        RecreateHandle();
        AssertTitleBarTheme(true);
        WindowState = FormWindowState.Maximized;
        trayMenu.Items[1].PerformClick();
        trayMenu.Items[0].PerformClick();
        if (WindowState != FormWindowState.Maximized) throw new Exception("Tray restore lost the maximized window state.");
        AssertTitleBarTheme(true);
        WindowState = FormWindowState.Normal;
        HostAppearance("{\"type\":\"appearance\",\"theme\":\"light\",\"language\":\"zh-CN\"}");
        RecreateHandle();
        AssertTitleBarTheme(false);
        trayMenu.Items[1].PerformClick();
        trayMenu.Items[0].PerformClick();
        AssertTitleBarTheme(false);
        HostAppearance("{\"type\":\"appearance\",\"theme\":\"dark\",\"language\":\"zh-CN\"}");
        if (trayMenu.Items[3].Text != "退出" || BackColor != Color.FromArgb(30,29,27)) throw new Exception("Desktop appearance synchronization failed.");
        await Task.Delay(1000);
        string evidence = Path.Combine(root, "docs\\screenshots\\v2-desktop.png");
        Directory.CreateDirectory(Path.GetDirectoryName(evidence));
        using (var stream = File.Create(evidence)) await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
        string state = await web.CoreWebView2.ExecuteScriptAsync("JSON.stringify({title:document.title,nodes:document.querySelectorAll('[data-thought]').length,toolbar:!!document.querySelector('.topbar'),runtime:navigator.userAgent})");
        File.WriteAllText(Path.Combine(root, ".test-data\\desktop-test.json"), state);
        File.WriteAllText(Path.Combine(root, ".test-data\\desktop-package-test.json"), new JavaScriptSerializer().Serialize(new { installedMode = Installed, bundledNode = nodePath == Path.Combine(root, "runtime", "node.exe"), dataDirectory = dataPath, defaultDataDirectory = Path.Combine(UserRoot, "projects") }));
        File.WriteAllText(Path.Combine(root, ".test-data\\desktop-tray-test.json"), "{\"icon\":true,\"halfScreenSize\":true,\"taskbarMinimize\":true,\"trayMinimize\":true,\"restore\":true,\"localizedMenu\":true,\"darkTitleBarRestored\":true,\"lightTitleBarRestored\":true,\"handleRecreation\":true,\"maximizedRestore\":true}");
        Close();
    }
    void AssertTitleBarTheme(bool expectedDark) {
        int value;
        int result = DwmGetWindowAttribute(Handle, 20, out value, sizeof(int));
        if (result != 0) result = DwmGetWindowAttribute(Handle, 19, out value, sizeof(int));
        if (result != 0 || (value != 0) != expectedDark) throw new Exception("Native title bar theme did not survive the window transition.");
    }
    void Stop() {
        if (stopping) return; stopping = true;
        if (tray != null) { tray.Visible = false; tray.Dispose(); }
        if (trayMenu != null) trayMenu.Dispose();
        if (web != null) web.Dispose();
        if (server != null) { try { if (!server.HasExited) { server.StandardInput.WriteLine("shutdown"); if (!server.WaitForExit(2000)) server.Kill(); } } catch (InvalidOperationException) {} catch (IOException) {} finally { server.Dispose(); } }
    }
}
