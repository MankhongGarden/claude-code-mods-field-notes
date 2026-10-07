using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

class Shot
{
    public int N;
    public string Source;
    public Bitmap Img;
    public int W, H;
    public bool Pending;
    public DateTime Since;
    public string[] Parts;
}

class Peek : Form
{
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc p, uint pid, uint tid, uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr h);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int v, int size);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObj, int idChild, uint thread, uint time);
    struct RECT { public int L, T, R, B; }

    const uint EVENT_SYSTEM_FOREGROUND = 0x0003, EVENT_SYSTEM_MINIMIZESTART = 0x0016, EVENT_SYSTEM_MINIMIZEEND = 0x0017;
    const uint EVENT_OBJECT_DESTROY = 0x8001, EVENT_OBJECT_LOCATIONCHANGE = 0x800B;

    static bool IsTerminal(IntPtr h)
    {
        if (h == IntPtr.Zero) return false;
        var sb = new StringBuilder(128);
        GetClassName(h, sb, 128);
        return sb.ToString() == "CASCADIA_HOSTING_WINDOW_CLASS";
    }

    static Color Cream = Color.FromArgb(0x1E, 0x1E, 0x1E);
    static Color Ink = Color.FromArgb(0xE6, 0xE6, 0xE6);
    static Color Dim = Color.FromArgb(0xA8, 0xA8, 0xA8);
    static Color Faint = Color.FromArgb(0x6E, 0x6E, 0x6E);
    static Color Edge = Color.FromArgb(0x3A, 0x3A, 0x3A);
    static Color Well = Color.FromArgb(0x2A, 0x2A, 0x2A);
    static bool Thai;
    static int OffsetBottom = 91, OffsetRight = 27;

    static void UseLightTheme()
    {
        Cream = Color.FromArgb(0xF2, 0xF0, 0xDA);
        Ink = Color.FromArgb(0x2D, 0x2A, 0x24);
        Dim = Color.FromArgb(0x6B, 0x67, 0x5E);
        Faint = Color.FromArgb(0xB9, 0xB5, 0xA3);
        Edge = Color.FromArgb(0xD9, 0xD5, 0xBF);
        Well = Color.FromArgb(0xE9, 0xE6, 0xCF);
    }

    static string Txt(string en, string th) { return Thai ? th : en; }

    static string Mono()
    {
        foreach (var name in new[] { "Cascadia Code", "Cascadia Mono", "Consolas" })
            if (FontFamily.Families.Any(f => f.Name == name)) return name;
        return FontFamily.GenericMonospace.Name;
    }

    readonly string statePath;
    IntPtr owner;
    readonly List<Shot> shots = new List<Shot>();
    readonly FileSystemWatcher watcher;
    readonly WinEventProc hookProc, fgProc;
    readonly Timer reloadTimer = new Timer { Interval = 40 };
    readonly Timer retryTimer = new Timer { Interval = 250 };
    IntPtr hook = IntPtr.Zero, fgHook = IntPtr.Zero;
    bool ownerActive = true;
    float s = 1f;
    int expanded = -1;
    bool dismissed;
    Rectangle closeRect;
    readonly List<KeyValuePair<Rectangle, int>> hits = new List<KeyValuePair<Rectangle, int>>();
    Font headFont, labelFont, smallFont;

    Peek(string statePath, IntPtr owner)
    {
        this.statePath = statePath;
        this.owner = owner;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        BackColor = Cream;
        DoubleBuffered = true;
        Location = new Point(-32000, -32000);
        Size = new Size(10, 10);

        using (var g = CreateGraphics()) s = g.DpiX / 96f;
        string ui = Thai ? "Leelawadee UI" : "Segoe UI";
        headFont = new Font(ui, 9f);
        labelFont = new Font(Mono(), 8.5f);
        smallFont = new Font(ui, 8f);

        reloadTimer.Tick += (o, e) => { reloadTimer.Stop(); Reload(); };
        watcher = new FileSystemWatcher(Path.GetDirectoryName(statePath), Path.GetFileName(statePath));
        watcher.NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName;
        FileSystemEventHandler kick = (o, e) => BeginInvoke((Action)(() => { reloadTimer.Stop(); reloadTimer.Start(); }));
        watcher.Changed += kick;
        watcher.Created += kick;
        watcher.Deleted += kick;
        watcher.Renamed += (o, e) => kick(o, e);
        watcher.EnableRaisingEvents = true;

        retryTimer.Tick += (o, e) => RetryPending();

        hookProc = OnWinEvent;
        fgProc = OnForeground;
    }

    void Adopt(IntPtr h)
    {
        owner = h;
        if (hook != IntPtr.Zero) UnhookWinEvent(hook);
        SetWindowLongPtr(Handle, -8, owner);
        uint pid;
        GetWindowThreadProcessId(owner, out pid);
        hook = SetWinEventHook(EVENT_OBJECT_DESTROY, EVENT_OBJECT_LOCATIONCHANGE, IntPtr.Zero, hookProc, pid, 0, 0);
    }

    void OnForeground(IntPtr h, uint ev, IntPtr hwnd, int idObj, int idChild, uint thread, uint time)
    {
        if (ev != EVENT_SYSTEM_FOREGROUND && ev != EVENT_SYSTEM_MINIMIZESTART && ev != EVENT_SYSTEM_MINIMIZEEND) return;
        if (hwnd == Handle) return;
        if (owner == IntPtr.Zero && IsTerminal(hwnd)) Adopt(hwnd);
        bool active = hwnd == owner && !IsIconic(owner);
        if (ev == EVENT_SYSTEM_MINIMIZESTART && hwnd == owner) active = false;
        if (ev == EVENT_SYSTEM_MINIMIZEEND && hwnd == owner) active = true;
        if (ev == EVENT_SYSTEM_FOREGROUND || hwnd == owner)
        {
            ownerActive = active;
            Relayout();
        }
    }

    protected override bool ShowWithoutActivation { get { return true; } }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= 0x08000000 | 0x80;
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int round = 2;
        try { DwmSetWindowAttribute(Handle, 33, ref round, 4); } catch { }
        if (owner != IntPtr.Zero) Adopt(owner);
        fgHook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZEEND, IntPtr.Zero, fgProc, 0, 0, 0);
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        Reload();
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        if (hook != IntPtr.Zero) UnhookWinEvent(hook);
        if (fgHook != IntPtr.Zero) UnhookWinEvent(fgHook);
        watcher.Dispose();
        base.OnFormClosed(e);
    }

    void OnWinEvent(IntPtr h, uint ev, IntPtr hwnd, int idObj, int idChild, uint thread, uint time)
    {
        if (hwnd != owner || idObj != 0) return;
        if (ev == EVENT_OBJECT_DESTROY || !IsWindow(owner)) { Close(); return; }
        if (ev == EVENT_OBJECT_LOCATIONCHANGE) Place();
    }

    List<string[]> ReadState()
    {
        for (int i = 0; i < 5; i++)
        {
            try
            {
                if (!File.Exists(statePath)) return null;
                return File.ReadAllLines(statePath, Encoding.UTF8)
                    .Select(l => l.Split('\t'))
                    .Where(p => p.Length >= 2)
                    .ToList();
            }
            catch (IOException) { System.Threading.Thread.Sleep(30); }
        }
        return new List<string[]>();
    }

    static Bitmap Shrink(Image src)
    {
        float k = Math.Min(1f, 900f / Math.Max(src.Width, src.Height));
        int w = Math.Max(1, (int)(src.Width * k)), h = Math.Max(1, (int)(src.Height * k));
        var b = new Bitmap(w, h);
        using (var g = Graphics.FromImage(b))
        {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.DrawImage(src, 0, 0, w, h);
        }
        return b;
    }

    static string FindInDir(string dir, int n)
    {
        if (!Directory.Exists(dir)) return null;
        return Directory.GetFiles(dir, n + ".*").FirstOrDefault();
    }

    Shot LoadShot(int n, string[] p)
    {
        var shot = new Shot { N = n, Source = string.Join("\t", p.Skip(1)), Since = DateTime.UtcNow };
        Fill(shot, p);
        return shot;
    }

    void Fill(Shot shot, string[] p)
    {
        try
        {
            Image src = null;
            string file = null;
            if (p[1] == "dir" && p.Length > 2) file = FindInDir(p[2], shot.N);
            else if (p[1] == "file" && p.Length > 2) file = p[2];
            if (file != null && File.Exists(file))
            {
                byte[] bytes = File.ReadAllBytes(file);
                using (var ms = new MemoryStream(bytes)) src = Image.FromStream(ms);
            }
            if (src != null)
            {
                shot.W = src.Width;
                shot.H = src.Height;
                shot.Img = Shrink(src);
                src.Dispose();
                shot.Pending = false;
                return;
            }
        }
        catch { }
        shot.Pending = (DateTime.UtcNow - shot.Since).TotalSeconds < 6;
        shot.Parts = p;
        if (shot.Pending) retryTimer.Start();
    }

    void RetryPending()
    {
        var waiting = shots.Where(x => x.Pending).ToList();
        if (waiting.Count == 0) { retryTimer.Stop(); return; }
        foreach (var x in waiting) Fill(x, x.Parts);
        if (!shots.Any(x => x.Pending)) retryTimer.Stop();
        Relayout();
    }

    void Reload()
    {
        var state = ReadState();
        if (state == null || state.Count == 0) { Close(); return; }
        var wanted = new Dictionary<int, string[]>();
        foreach (var p in state)
        {
            int n;
            if (int.TryParse(p[0], out n) && !wanted.ContainsKey(n)) wanted[n] = p;
        }
        if (wanted.Count == 0) { Close(); return; }

        bool added = false;
        foreach (var old in shots.Where(x => !wanted.ContainsKey(x.N)).ToList())
        {
            if (old.Img != null) old.Img.Dispose();
            shots.Remove(old);
        }
        foreach (var kv in wanted.OrderBy(k => k.Key))
        {
            if (shots.Any(x => x.N == kv.Key)) continue;
            shots.Add(LoadShot(kv.Key, kv.Value));
            added = true;
        }
        shots.Sort((a, b) => a.N.CompareTo(b.N));
        if (expanded >= 0 && !shots.Any(x => x.N == expanded)) expanded = -1;
        if (added) dismissed = false;
        Relayout();
    }

    int P(float v) { return (int)Math.Round(v * s); }

    int SlotWidth(Shot x, int h)
    {
        int label = TextRenderer.MeasureText("#" + x.N, labelFont).Width;
        if (x.W > 0) label += TextRenderer.MeasureText(x.W + "×" + x.H, labelFont).Width - P(6);
        return Math.Max(ThumbWidth(x, h), label);
    }

    int ThumbWidth(Shot x, int h)
    {
        if (x.W <= 0 || x.H <= 0) return h * 16 / 9;
        return Math.Max(P(40), Math.Min(P(200), h * x.W / x.H));
    }

    int MaxWidth()
    {
        RECT r;
        GetWindowRect(owner, out r);
        return Math.Max(P(200), (r.R - r.L) - P(60));
    }

    Size Measure()
    {
        int pad = P(8), head = P(22), label = P(18);
        if (expanded >= 0)
        {
            var x = shots.First(t => t.N == expanded);
            int ih = P(300);
            int iw = Math.Min(Math.Min(P(720), MaxWidth() - pad * 2), ThumbWidthFree(x, ih));
            ih = x.W > 0 ? Math.Min(ih, iw * x.H / x.W) : ih;
            return new Size(Math.Max(P(200), iw + pad * 2), pad + head + ih + P(4) + label + pad);
        }
        int th = P(68), gap = P(8), w = pad * 2;
        int limit = MaxWidth();
        for (int i = 0; i < shots.Count; i++)
        {
            int add = (i > 0 ? gap : 0) + SlotWidth(shots[i], th);
            if (w + add > limit) break;
            w += add;
        }
        return new Size(Math.Max(P(170), w), pad + head + th + P(4) + label + pad);
    }

    int ThumbWidthFree(Shot x, int h)
    {
        if (x.W <= 0 || x.H <= 0) return h * 16 / 9;
        return h * x.W / x.H;
    }

    void Relayout()
    {
        if (dismissed || shots.Count == 0 || owner == IntPtr.Zero || !ownerActive) { Hide(); return; }
        Size = Measure();
        Place();
        if (!Visible) Show();
        SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
        Invalidate();
    }

    void Place()
    {
        if (!IsHandleCreated || !IsWindow(owner)) return;
        RECT r;
        if (!GetWindowRect(owner, out r)) return;
        var want = new Point(r.R - Width - P(OffsetRight), r.B - Height - P(OffsetBottom));
        var area = Screen.FromHandle(owner).WorkingArea;
        Location = new Point(Math.Max(area.Left, Math.Min(want.X, area.Right - Width)), Math.Max(area.Top, Math.Min(want.Y, area.Bottom - Height)));
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        hits.Clear();
        int pad = P(8), head = P(22);
        using (var border = new Pen(Faint, 1)) g.DrawRectangle(border, 0, 0, Width - 1, Height - 1);

        closeRect = new Rectangle(Width - pad - P(16), pad, P(16), P(16));
        TextRenderer.DrawText(g, "×", headFont, closeRect, Faint, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);

        if (expanded >= 0)
        {
            var x = shots.First(t => t.N == expanded);
            string title = "#" + x.N + (x.W > 0 ? "  ·  " + x.W + "×" + x.H : "");
            TextRenderer.DrawText(g, title, labelFont, new Point(pad, pad + P(2)), Dim);
            var area = new Rectangle(pad, pad + head, Width - pad * 2, Height - pad * 2 - head - P(22));
            DrawImage(g, x, area);
            hits.Add(new KeyValuePair<Rectangle, int>(area, x.N));
            TextRenderer.DrawText(g, Txt("click to shrink", "คลิกเพื่อย่อ"), smallFont, new Point(pad, Height - pad - P(16)), Faint);
            return;
        }

        TextRenderer.DrawText(g, Txt("Attached", "รูปที่แนบ") + "  ·  " + shots.Count, headFont, new Point(pad, pad), Dim);
        int th = P(68), gap = P(8), cx = pad, top = pad + head;
        int shown = 0;
        foreach (var x in shots)
        {
            int tw = ThumbWidth(x, th), sw = SlotWidth(x, th);
            if (cx + sw + pad > Width && shown > 0) break;
            var rect = new Rectangle(cx, top, tw, th);
            DrawImage(g, x, rect);
            hits.Add(new KeyValuePair<Rectangle, int>(rect, x.N));
            TextRenderer.DrawText(g, "#" + x.N, labelFont, new Point(cx - P(2), top + th + P(3)), Ink);
            if (x.W > 0)
            {
                var nw = TextRenderer.MeasureText(g, "#" + x.N, labelFont).Width;
                TextRenderer.DrawText(g, x.W + "×" + x.H, labelFont, new Point(cx - P(2) + nw - P(4), top + th + P(3)), Faint);
            }
            cx += sw + gap;
            shown++;
        }
        if (shown < shots.Count)
            TextRenderer.DrawText(g, "+" + (shots.Count - shown), labelFont, new Point(Width - pad - P(24), top + th / 2 - P(8)), Dim);
    }

    void DrawImage(Graphics g, Shot x, Rectangle area)
    {
        using (var well = new SolidBrush(Well)) g.FillRectangle(well, area);
        if (x.Img == null)
        {
            TextRenderer.DrawText(g, x.Pending ? Txt("loading…", "กำลังโหลด…") : Txt("no preview", "ไม่มีตัวอย่าง"), smallFont, area, Dim, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak);
        }
        else
        {
            float k = Math.Min((float)area.Width / x.Img.Width, (float)area.Height / x.Img.Height);
            int w = (int)(x.Img.Width * k), h = (int)(x.Img.Height * k);
            g.DrawImage(x.Img, area.X + (area.Width - w) / 2, area.Y + (area.Height - h) / 2, w, h);
        }
        using (var edge = new Pen(Edge, 1)) g.DrawRectangle(edge, area.X, area.Y, area.Width - 1, area.Height - 1);
    }

    protected override void OnMouseClick(MouseEventArgs e)
    {
        base.OnMouseClick(e);
        if (closeRect.Contains(e.Location)) { dismissed = true; expanded = -1; Hide(); return; }
        foreach (var kv in hits)
        {
            if (!kv.Key.Contains(e.Location)) continue;
            expanded = expanded >= 0 ? -1 : kv.Value;
            Relayout();
            return;
        }
    }

    [STAThread]
    static void Main(string[] args)
    {
        if (args.Length < 1) return;
        IntPtr owner = IntPtr.Zero;
        for (int i = 1; i + 1 < args.Length; i += 2)
        {
            string k = args[i], v = args[i + 1];
            int n;
            if (k == "--lang") Thai = v == "th";
            else if (k == "--theme" && v == "light") UseLightTheme();
            else if (k == "--bottom" && int.TryParse(v, out n)) OffsetBottom = n;
            else if (k == "--right" && int.TryParse(v, out n)) OffsetRight = n;
            else if (k == "--hwnd") owner = new IntPtr(long.Parse(v));
        }
        SetProcessDPIAware();
        if (owner == IntPtr.Zero) owner = GetForegroundWindow();
        if (!IsTerminal(owner)) owner = IntPtr.Zero;
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new Peek(Path.GetFullPath(args[0]), owner));
    }
}