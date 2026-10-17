// AM-Log.js - logging to the PixInsight console and to a log file.

AM.Log = {
   path: "",

   init: function(dir, name)
   {
      AM.ensureDir(dir);
      this.path = AM.joinPath(dir, name);
      this._lines = [];
      try { File.writeTextFile(this.path, ""); } catch (e) { this.path = ""; }
   },

   _lines: [],

   // File.appendToTextFile is not available in all versions: keep the lines in
   // memory and rewrite the whole (small) file.
   _file: function(level, msg)
   {
      if (!this.path) return;
      this._lines.push("[" + level + "] " + msg);
      try { File.writeTextFile(this.path, this._lines.join("\n") + "\n"); } catch (e) {}
   },

   info: function(msg)    { console.writeln("<end><cbr><raw>" + msg + "</raw>"); this._file("INFO", msg); },
   note: function(msg)    { console.noteln("<end><cbr><raw>" + msg + "</raw>"); this._file("INFO", msg); },
   warn: function(msg)    { console.warningln("<end><cbr><raw>** Warning: " + msg + "</raw>"); this._file("WARN", msg); },
   error: function(msg)   { console.criticalln("<end><cbr><raw>*** Error: " + msg + "</raw>"); this._file("ERROR", msg); },
   step: function(msg)
   {
      console.writeln("<end><cbr><br><b>" + "=".repeat(8) + " </b><raw>" + msg + "</raw>");
      this._file("STEP", msg);
   }
};
