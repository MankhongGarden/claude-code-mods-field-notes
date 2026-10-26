using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

static class MatrixIntro
{
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
    [DllImport("kernel32.dll")] static extern bool GetConsoleMode(IntPtr h, out uint m);
    [DllImport("kernel32.dll")] static extern bool SetConsoleMode(IntPtr h, uint m);
    [DllImport("kernel32.dll")] static extern bool GetConsoleScreenBufferInfo(IntPtr h, out CSBI i);
    [DllImport("kernel32.dll")] static extern bool SetConsoleWindowInfo(IntPtr h, bool abs, ref SMALL_RECT r);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool ReadConsoleOutputCharacter(IntPtr h, StringBuilder s, uint len, COORD at, out uint read);
    [StructLayout(LayoutKind.Sequential)] struct COORD { public short X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct SMALL_RECT { public short L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct CSBI { public COORD Size, Cursor; public short Attr; public SMALL_RECT Win; public COORD Max; }

    const string Glyphs = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789";
    static readonly string[] Shades = {
        "\x1b[38;2;45;42;36m", "\x1b[38;2;69;65;58m", "\x1b[38;2;107;103;94m",
        "\x1b[38;2;143;139;127m", "\x1b[38;2;185;181;163m", "\x1b[38;2;210;206;180m" };
    const int MaxMs = 20000;
    const int FrameMs = 33;

    static int Main(string[] args)
    {
        StartUpdater();

        if (Environment.GetEnvironmentVariable("CLAUDE_MATRIX_INTRO") == "0" || Console.IsOutputRedirected) return 0;
        foreach (var a in args)
            if (Regex.IsMatch(a, "^(-p|--print|-v|--version|-h|--help)$") || !a.StartsWith("-")) return 0;

        int W, H;
        try { W = Console.WindowWidth; H = Console.WindowHeight; } catch { return 0; }
        if (W < 40 || H < 10) return 0;

        var mark = Environment.GetEnvironmentVariable("CC_INTRO_MARK");
        if (!string.IsNullOrEmpty(mark)) { try { File.WriteAllText(mark, ""); } catch { } }

        var hOut = GetStdHandle(-11);
        uint mode;
        if (GetConsoleMode(hOut, out mode)) SetConsoleMode(hOut, mode | 0x0004);
        var o =new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false), 1 << 16);

        var configDir = Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR");
        if (string.IsNullOrEmpty(configDir)) configDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude");
        var claudeJson = Path.Combine(configDir, ".claude.json");
        int startups0 = StartupCount(claudeJson);

        var rnd = new Random();
        string name = string.Join(" ", new DirectoryInfo(Environment.CurrentDirectory).Name.ToUpperInvariant().ToCharArray());
        if (name.Length > W - 8) name = name.Substring(0, W - 8);

        var chars = new char[W, H];
        for (int x = 0; x < W; x++) for (int y = 0; y < H; y++) chars[x, y] = Glyphs[rnd.Next(Glyphs.Length)];
        var dy = new double[W]; var sp = new double[W]; var ln = new int[W]; var last = new int[W];
        for (int x = 0; x < W; x++)
        {
            ln[x] = 6 + rnd.Next(Math.Max(4, (int)(H * 0.7)));
            dy[x] = rnd.Next(-H / 3, H + ln[x]);
            sp[x] = 0.55 + rnd.NextDouble() * 0.45;
            last[x] = -999;
        }

        o.Write("\x1b[?25l\x1b[2J\x1b[3J\x1b[H");
        o.Flush();

        int nameRow = H / 2, nameCol = (W - name.Length) / 2;
        var sw = Stopwatch.StartNew();
        long nextCheck = 0;
        var sb = new StringBuilder(1 << 15);

        while (sw.ElapsedMilliseconds < MaxMs)
        {
            long t = sw.ElapsedMilliseconds;
            if (t >= nextCheck)
            {
                nextCheck = t + 120;
                if (startups0 >= 0 && StartupCount(claudeJson) > startups0) break;
                if (ClaudeDrew(hOut, W, H, nameRow)) break;
            }
            sb.Clear();
            for (int x = 0; x < W; x++)
            {
                dy[x] += sp[x];
                int head = (int)Math.Floor(dy[x]);
                if (head == last[x]) continue;
                int len = ln[x];
                bool first = last[x] == -999;
                last[x] = head;
                if (first)
                {
                    for (int k = 0; k < len; k++)
                    {
                        int y = head - k;
                        if (y < 0 || y >= H) continue;
                        int idx = k == 0 ? 0 : Math.Min(Shades.Length - 1, 1 + (int)Math.Floor((double)k / len * (Shades.Length - 1)));
                        Cell(sb, x, y).Append(Shades[idx]).Append(chars[x, y]);
                    }
                    continue;
                }
                if (head >= 0 && head < H) Cell(sb, x, head).Append(Shades[0]).Append(Glyphs[rnd.Next(Glyphs.Length)]);
                for (int j = 1; j < Shades.Length; j++)
                {
                    int k = j == 1 ? 1 : (int)Math.Ceiling((double)(j - 1) * len / (Shades.Length - 1));
                    int y = head - k;
                    if (y >= 0 && y < H) Cell(sb, x, y).Append(Shades[j]).Append(chars[x, y]);
                }
                int tail = head - len;
                if (tail >= 0 && tail < H) Cell(sb, x, tail).Append(' ');
                if (head - len > H) { dy[x] = -rnd.Next(1, Math.Max(2, H / 3)); last[x] = -1000; }
            }
            if (t > 400)
            {
                double p = Math.Min(1.0, (t - 400) / 1400.0);
                int n = (int)Math.Floor(name.Length * p);
                string pad = new string(' ', name.Length + 6);
                for (int r = -1; r <= 1; r++) sb.Append("\x1b[").Append(nameRow + r + 1).Append(';').Append(nameCol - 1).Append("H\x1b[0m").Append(pad);
                Cell(sb, nameCol, nameRow);
                for (int i = 0; i < name.Length; i++)
                {
                    if (i < n) sb.Append("\x1b[1m").Append(Shades[0]).Append(name[i]).Append("\x1b[22m");
                    else if (i < n + 3 && name[i] != ' ') sb.Append(Shades[3]).Append(Glyphs[rnd.Next(Glyphs.Length)]);
                    else sb.Append(' ');
                }
            }
            o.Write(sb.ToString());
            o.Flush();
            int spare = FrameMs - (int)(sw.ElapsedMilliseconds - t);
            if (spare > 0) Thread.Sleep(spare);
        }
        o.Write("\x1b[0m\x1b[2J\x1b[3J\x1b[H");
        o.Flush();
        Thread.Sleep(400);
        ForceRedraw(hOut);
        return 0;
    }

    static void ForceRedraw(IntPtr hOut)
    {
        CSBI i;
        if (!GetConsoleScreenBufferInfo(hOut, out i)) return;
        var w = i.Win;
        if (w.R - w.L < 2) return;
        w.R -= 1;
        if (!SetConsoleWindowInfo(hOut, true, ref w)) return;
        Thread.Sleep(150);
        w.R += 1;
        SetConsoleWindowInfo(hOut, true, ref w);
    }

    static bool ClaudeDrew(IntPtr hOut, int W, int H, int nameRow)
    {
        CSBI i;
        if (!GetConsoleScreenBufferInfo(hOut, out i)) return false;
        var buf = new StringBuilder(W + 1);
        int hits = 0;
        for (int y = 0; y < H; y++)
        {
            if (y >= nameRow - 1 && y <= nameRow + 1) continue;
            buf.Length = 0;
            buf.Capacity = Math.Max(buf.Capacity, W + 1);
            uint read;
            var at = new COORD { X = i.Win.L, Y = (short)(i.Win.T + y) };
            if (!ReadConsoleOutputCharacter(hOut, buf, (uint)W, at, out read)) return false;
            for (int k = 0; k < read && k < buf.Length; k++)
            {
                char c = buf[k];
                if ((c >= 'a' && c <= 'z') || c == '─' || c == '❯') hits++;
            }
            if (hits >= 8) return true;
        }
        return false;
    }

    static StringBuilder Cell(StringBuilder sb, int x, int y)
    {
        return sb.Append("\x1b[").Append(y + 1).Append(';').Append(x + 1).Append('H');
    }

    static int StartupCount(string path)
    {
        try
        {
            string text;
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var rd = new StreamReader(fs)) text = rd.ReadToEnd();
            var m = Regex.Match(text, "\"numStartups\"\\s*:\\s*(\\d+)");
            return m.Success ? int.Parse(m.Groups[1].Value) : -1;
        }
        catch { return -1; }
    }

    static void StartUpdater()
    {
        try
        {
            var script = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "claude-update-safe.ps1");
            if (!File.Exists(script)) return;
            var psi = new ProcessStartInfo("pwsh", "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            Process.Start(psi);
        }
        catch { }
    }
}
