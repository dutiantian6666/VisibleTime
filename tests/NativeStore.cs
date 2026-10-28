using System;
using System.IO;
using System.Linq;
using VisibleTime;

internal static class NativeStoreTests {
    private static int passed;
    private static void Assert(bool valid, string message) { if (!valid) throw new Exception(message); }
    private static void Reject(Action action) {
        bool rejected = false;
        try { action(); } catch { rejected = true; }
        Assert(rejected, "Invalid input was accepted.");
    }
    private static void Check(string name, Action action) { action(); passed++; Console.WriteLine("PASS " + name); }
    private static int Main(string[] args) {
        var directory = Path.GetFullPath(args[0]);
        Directory.CreateDirectory(directory);
        var raw = "{\"version\":1,\"tasks\":[{\"id\":\"t\",\"name\":\"Read\",\"completed\":false,\"createdAt\":1000,\"completedAt\":null}],\"sessions\":[{\"id\":\"s\",\"taskId\":\"t\",\"start\":1000,\"end\":2000,\"source\":\"manual\",\"note\":\"A chapter\"}]}";
        try {
            using (var store = new Store(Path.Combine(directory, "data"))) {
                Check("SQLite persistence and compare-and-save", delegate {
                    store.Save(raw, store.Raw());
                    Assert(store.Raw() == raw, "Payload changed.");
                    Reject(delegate { store.Save("{\"version\":1,\"tasks\":[],\"sessions\":[]}", "{}"); });
                    Assert(store.Raw() == raw, "Stale save overwrote state.");
                });
                Check("State validation rejects invalid fields", delegate {
                    foreach (var invalid in new[] {
                        raw.Replace("\"version\":1", "\"version\":2"),
                        raw.Replace("\"start\":1000", "\"start\":1.5"),
                        raw.Replace("\"end\":2000", "\"end\":999"),
                        raw.Replace("\"taskId\":\"t\"", "\"taskId\":\"missing\""),
                        raw.Replace("\"completed\":false", "\"completed\":true"),
                        raw.Replace("\"source\":\"manual\"", "\"source\":\"unknown\""),
                        raw.Replace("\"note\":\"A chapter\"", "\"note\":false"),
                    }) Reject(delegate { store.Save(invalid, store.Raw()); });
                    Assert(store.Raw() == raw, "Invalid save changed state.");
                });
                Check("Export and atomic replacement", delegate {
                    var file = Path.Combine(directory, "export.json");
                    store.Export(file); store.Export(file);
                    Assert(Json.Items(Store.ReadBackup(file), "tasks").Length == 1, "Export lost task.");
                    Assert(!Directory.GetFiles(directory, "*.tmp").Any(), "Temporary file leaked.");
                });
                Check("Import validation and pre-import backup", delegate {
                    var file = Path.Combine(directory, "invalid.json");
                    File.WriteAllText(file, "{\"version\":99}");
                    Reject(delegate { Store.ReadBackup(file); });
                    Assert(store.Raw() == raw, "Bad import changed state.");
                    var backup = store.Import(Json.State(raw));
                    Assert(File.Exists(backup) && backup.Contains("before-import"), "Missing pre-import backup.");
                });
                Check("Running imports stop at export time", delegate {
                    var running = Json.State(raw.Replace("\"end\":2000", "\"end\":null"));
                    var next = Json.DecodeBackup(Json.Encode(new { format = "visible-time-backup", formatVersion = 1, exportedAt = 3000, state = running }));
                    Assert(Json.Number(Json.Object(Json.Items(next, "sessions")[0])["end"]) == 3000, "Imported running session advanced.");
                });
                Check("Daily backup is idempotent", delegate {
                    store.Daily(); store.Daily();
                    Assert(Directory.GetFiles(store.Backups, "*-daily-*.json").Length == 1, "Duplicate daily backup.");
                });
                store.Save(raw.Replace("\"end\":2000", "\"end\":null"), store.Raw());
                store.Heartbeat();
            }
            Check("Crash recovery stops at the persisted heartbeat", delegate {
                var now = Json.Now();
                using (var store = new Store(Path.Combine(directory, "data"))) {
                    Assert(store.Recovered, "Missing interrupted session recovery.");
                    var end = Json.Number(Json.Object(Json.Items(Json.State(store.Raw()), "sessions")[0])["end"]);
                    Assert(end <= now && end >= now - 5000, "Wrong recovery cutoff.");
                    store.Pause();
                }
            });
            Check("A damaged database is not reset", delegate {
                var corrupt = Path.Combine(directory, "corrupt");
                Directory.CreateDirectory(corrupt);
                var file = Path.Combine(corrupt, "visible-time.db");
                File.WriteAllText(file, "preserve this damaged database");
                Reject(delegate { using (var store = new Store(corrupt)) {} });
                Assert(File.ReadAllText(file) == "preserve this damaged database", "Corrupt data was overwritten.");
            });
            Console.WriteLine(passed + " native SQLite checks passed.");
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
