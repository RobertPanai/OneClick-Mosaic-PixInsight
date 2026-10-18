// AM-Log.js - logging to the PixInsight console and to a log file.

AM.Log = {
   path: "",

   // Without a folder the log is kept in memory only (nothing is written to disk).
   init: function(dir, name)
   {
      this._lines = [];
      this.path = "";
      if (!dir) return;
      try {
         AM.ensureDir(dir);
         this.path = AM.joinPath(dir, name);
         File.writeTextFile(this.path, "");
      } catch (e) { this.path = ""; }
   },

   // Writes the log collected so far to 'path' (used when the user chooses to save the mosaics).
   save: function(path)
   {
      try { File.writeTextFile(path, this._lines.join("\n") + "\n"); return true; } catch (e) { return false; }
   },

   _lines: [],

   // File.appendToTextFile is not available in all versions: keep the lines in
   // memory and rewrite the whole (small) file.
   _file: function(level, msg)
   {
      this._lines.push("[" + level + "] " + msg);
      if (!this.path) return;
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
