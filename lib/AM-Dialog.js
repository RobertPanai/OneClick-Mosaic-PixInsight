// AM-Dialog.js - AutoMosaic user interface.

// ---------------------------------------------------------------------------
// Small helper dialogs
// ---------------------------------------------------------------------------

// Lets the user check some of the open image windows.
function AM_WindowsDialog()
{
   this.__base__ = Dialog;
   this.__base__();
   var self = this;
   this.selected = [];

   var info = new Label(this);
   info.text = "Select the open images to use as panels. They are copied to <output>/_input, the windows are never modified.";
   info.wordWrapping = true;

   this.tree = new TreeBox(this);
   this.tree.numberOfColumns = 2;
   this.tree.headerVisible = true;
   this.tree.setHeaderText(0, "Window");
   this.tree.setHeaderText(1, "Size");
   this.tree.setMinSize(420, 260);
   var ws = ImageWindow.windows;
   this.windows = [];
   for (var i = 0; i < ws.length; ++i) {
      var w = ws[i];
      if (w.mainView.isNull) continue;
      var node = new TreeBoxNode(this.tree);
      node.setText(0, w.mainView.id);
      node.setText(1, w.mainView.image.width + " x " + w.mainView.image.height + " x " + w.mainView.image.numberOfChannels);
      node.checkable = true;
      node.checked = false;
      this.windows.push(w);
   }

   var ok = new PushButton(this);
   ok.text = "OK";
   ok.defaultButton = true;
   ok.onClick = function()
   {
      self.selected = [];
      for (var i = 0; i < self.tree.numberOfChildren; ++i)
         if (self.tree.child(i).checked) self.selected.push(self.windows[i]);
      self.ok();
   };
   var cancel = new PushButton(this);
   cancel.text = "Cancel";
   cancel.onClick = function() { self.cancel(); };

   var buttons = new HorizontalSizer;
   buttons.spacing = 6;
   buttons.addStretch();
   buttons.add(ok);
   buttons.add(cancel);

   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 6;
   this.sizer.add(info);
   this.sizer.add(this.tree, 100);
   this.sizer.add(buttons);
   this.windowTitle = "AutoMosaic - Add Windows";
   this.adjustToContents();
}
AM_WindowsDialog.prototype = new Dialog;

// Asks for a filter name, offering the existing ones.
function AM_FilterNameDialog(title, existing, initial)
{
   this.__base__ = Dialog;
   this.__base__();
   var self = this;
   this.name = "";

   var label = new Label(this);
   label.text = "Filter:";
   label.textAlignment = TextAlign_Right | TextAlign_VertCenter;

   this.combo = new ComboBox(this);
   this.combo.editEnabled = true;
   for (var i = 0; i < existing.length; ++i) this.combo.addItem(existing[i]);
   this.combo.editText = initial || "";
   this.combo.setMinWidth(220);

   var ok = new PushButton(this);
   ok.text = "OK";
   ok.defaultButton = true;
   ok.onClick = function()
   {
      var n = ("" + self.combo.editText).replace(/^\s+|\s+$/g, "");
      if (n.length === 0) return;
      self.name = AM.safeName(n);
      self.ok();
   };
   var cancel = new PushButton(this);
   cancel.text = "Cancel";
   cancel.onClick = function() { self.cancel(); };

   var row = new HorizontalSizer;
   row.spacing = 6;
   row.add(label);
   row.add(this.combo, 100);
   var buttons = new HorizontalSizer;
   buttons.spacing = 6;
   buttons.addStretch();
   buttons.add(ok);
   buttons.add(cancel);
   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 8;
   this.sizer.add(row);
   this.sizer.add(buttons);
   this.windowTitle = title;
   this.adjustToContents();
   this.setFixedSize();
}
AM_FilterNameDialog.prototype = new Dialog;

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

function AM_Dialog(groups, opts)
{
   this.__base__ = Dialog;
   this.__base__();
   var self = this;
   this.groups = groups;
   this.opts = opts;

   var labelWidth = this.font.width("Reference filter:_");

   // ---- title --------------------------------------------------------------
   var title = new Label(this);
   title.useRichText = true;
   title.wordWrapping = true;
   title.frameStyle = FrameStyle_Box;
   title.margin = 6;
   title.text = "<b>" + AM.TITLE + " v" + AM.VERSION + "</b> &mdash; for every filter: " +
      "[ImageSolver] &rarr; registration &rarr; trim &rarr; photometric join &rarr; common autocrop.<br/>" +
      "Panels without astrometric data are detected automatically; PixInsight's ImageSolver is opened for them. " +
      "Nothing is saved unless you choose to: the cropped mosaics are opened in PixInsight.";

    this.warn_Label = new Label(this);
    this.warn_Label.useRichText = true;
    this.warn_Label.wordWrapping = true;
    this.warn_Label.frameStyle = FrameStyle_Box;
    this.warn_Label.margin = 6;
    this.warn_Label.visible = false;

   // ---- panel tree ---------------------------------------------------------
   this.tree = new TreeBox(this);
   this.tree.multipleSelection = true;
   this.tree.numberOfColumns = 3;
   this.tree.headerVisible = true;
   this.tree.setHeaderText(0, "Filter / panel");
   this.tree.setHeaderText(1, "WCS");
   this.tree.setHeaderText(2, "Path");
   this.tree.setColumnWidth(0, 260);
   this.tree.setColumnWidth(1, 50);
   this.tree.setMinSize(640, 260);
   this.tree.toolTip = "Panels grouped by filter. The order of the panels of a filter is the merge order; " +
      "the first panel is the first reference.";

   this.refreshTree = function()
   {
      self.tree.clear();
      for (var i = 0; i < self.groups.length; ++i) {
         var g = self.groups[i];
         var node = new TreeBoxNode(self.tree);
         node.setText(0, g.name + "  (" + g.panels.length + ")");
         node.AM_group = g;
         for (var j = 0; j < g.panels.length; ++j) {
            var p = g.panels[j];
            var child = new TreeBoxNode(node);
            child.setText(0, p.name);
            child.setText(1, p.hasWcs === null ? "?" : (p.hasWcs ? "yes" : "no"));
            child.setText(2, p.path);
            child.AM_panel = p;
            child.AM_group = g;
         }
         node.expanded = true;
      }
      self.refreshReferenceCombo();
      self.updateAstrometryNotice();
   };

   // Panels whose astrometric solution is known to be missing, as [{group, panel}].
   this.panelsWithoutSolution = function()
   {
      var list = [];
      for (var i = 0; i < self.groups.length; ++i)
         for (var j = 0; j < self.groups[i].panels.length; ++j)
            if (self.groups[i].panels[j].hasWcs === false) list.push(self.groups[i].panels[j]);
      return list;
   };

   // Automatic notice under the panel list: which panels lack astrometric data and what will happen.
   this.updateAstrometryNotice = function()
   {
      var miss = self.panelsWithoutSolution();
      if (miss.length === 0) { self.warn_Label.visible = false; self.adjustToContents(); return; }
      var names = [];
      for (var i = 0; i < miss.length && i < 6; ++i) names.push(miss[i].name);
      var action = !self.solve_CheckBox.checked ?
         "<b>Plate solving is switched off</b>: these panels cannot be mosaicked. Tick the option below to solve them with ImageSolver." :
         "ImageSolver will open for each of them before the mosaic starts (a copy is solved; the original is not modified).";
      self.warn_Label.text = "<b>&#9888; " + miss.length + " of " + self.totalPanels() + " panel(s) have no astrometric data:</b> " +
         names.join(", ") + (miss.length > 6 ? ", ..." : "") + ".<br/>" + action;
      self.warn_Label.visible = true;
      self.adjustToContents();
   };

   this.totalPanels = function()
   {
      var n = 0;
      for (var i = 0; i < self.groups.length; ++i) n += self.groups[i].panels.length;
      return n;
   };

   // Selected panels as [{group, panel}], plus selected filter nodes as groups.
   this.selection = function()
   {
      var panels = [], filters = [];
      var nodes = self.tree.selectedNodes;
      for (var i = 0; i < nodes.length; ++i) {
         if (nodes[i].AM_panel) panels.push({ group: nodes[i].AM_group, panel: nodes[i].AM_panel });
         else if (nodes[i].AM_group) filters.push(nodes[i].AM_group);
      }
      return { panels: panels, filters: filters };
   };

   this.addPaths = function(paths)
   {
      if (paths.length === 0) return;
      console.show();
      var added = AM.Inputs.addPaths(self.groups, paths);
      // WCS column: definitive check (opens the image only when the header is not conclusive)
      for (var i = 0; i < self.groups.length; ++i)
         for (var j = 0; j < self.groups[i].panels.length; ++j) {
            var p = self.groups[i].panels[j];
            if (p.hasWcs === null) { p.hasWcs = AM.Wcs.hasValidSolution(p.path); processEvents(); }
         }
      console.hide();
      self.refreshTree();
   };

   // ---- buttons ------------------------------------------------------------
   function button(text, tip, onClick)
   {
      var b = new PushButton(self);
      b.text = text;
      b.toolTip = tip;
      b.onClick = onClick;
      return b;
   }

   var addFiles = button("Add Files", "Add image files (.xisf, .fits, .fit, .fts). They are grouped by filter automatically.", function()
   {
      var d = new OpenFileDialog();
      d.multipleSelections = true;
      d.caption = "AutoMosaic - Add panels";
      d.filters = [["Images", "*.xisf", "*.fits", "*.fit", "*.fts"], ["All files", "*"]];
      if (d.execute()) self.addPaths(d.fileNames);
   });

   var addFolder = button("Add Folder", "Add all the images of a folder.", function()
   {
      var d = new GetDirectoryDialog();
      d.caption = "AutoMosaic - Add folder";
      if (d.execute()) self.addPaths(AM.Inputs.listFolder(d.directory, self.recurse_CheckBox.checked));
   });

   var addWindows = button("Add Windows", "Add images that are open in PixInsight. A temporary copy is used; the windows are not modified.", function()
   {
      self.readControls();
      var d = new AM_WindowsDialog();
      if (!d.execute() || d.selected.length === 0) return;
      var paths = AM.Inputs.exportWindows(d.selected, AM.joinPath(AM.workDir(), "_input"));
      self.addPaths(paths);
      for (var i = 0; i < paths.length; ++i)
         for (var g = 0; g < self.groups.length; ++g)
            for (var p = 0; p < self.groups[g].panels.length; ++p)
               if (self.groups[g].panels[p].path === AM.normPath(paths[i]))
                  self.groups[g].panels[p].sourceViewId = File.extractName(paths[i]);
   });

   var removeBtn = button("Remove", "Remove the selected panels (or whole filters).", function()
   {
      var s = self.selection();
      for (var i = 0; i < s.panels.length; ++i) {
         var arr = s.panels[i].group.panels;
         var k = arr.indexOf(s.panels[i].panel);
         if (k >= 0) arr.splice(k, 1);
      }
      for (var f = 0; f < s.filters.length; ++f) {
         var gi = self.groups.indexOf(s.filters[f]);
         if (gi >= 0) self.groups.splice(gi, 1);
      }
      for (var e = self.groups.length - 1; e >= 0; --e)
         if (self.groups[e].panels.length === 0) self.groups.splice(e, 1);
      self.refreshTree();
   });

   function move(delta)
   {
      var s = self.selection();
      if (s.panels.length !== 1) return;
      var arr = s.panels[0].group.panels;
      var k = arr.indexOf(s.panels[0].panel);
      var n = k + delta;
      if (k < 0 || n < 0 || n >= arr.length) return;
      var t = arr[k]; arr[k] = arr[n]; arr[n] = t;
      self.refreshTree();
   }
   var upBtn = button("Up", "Move the selected panel up (earlier in the merge order).", function() { move(-1); });
   var downBtn = button("Down", "Move the selected panel down.", function() { move(1); });

   var moveBtn = button("Move to filter...", "Move the selected panels to another filter (existing or new).", function()
   {
      var s = self.selection();
      if (s.panels.length === 0) return;
      var names = [];
      for (var i = 0; i < self.groups.length; ++i) names.push(self.groups[i].name);
      var d = new AM_FilterNameDialog("AutoMosaic - Move to filter", names, "");
      if (!d.execute()) return;
      var target = AM.Inputs.findGroup(self.groups, d.name);
      if (!target) { target = new AM.FilterGroup(d.name); self.groups.push(target); }
      for (var j = 0; j < s.panels.length; ++j) {
         var arr = s.panels[j].group.panels;
         var k = arr.indexOf(s.panels[j].panel);
         if (k >= 0) arr.splice(k, 1);
         target.addPanel(s.panels[j].panel);
      }
      for (var e = self.groups.length - 1; e >= 0; --e)
         if (self.groups[e].panels.length === 0) self.groups.splice(e, 1);
      self.refreshTree();
   });

   var renameBtn = button("Rename filter", "Rename the selected filter.", function()
   {
      var s = self.selection();
      var g = s.filters.length > 0 ? s.filters[0] : (s.panels.length > 0 ? s.panels[0].group : null);
      if (!g) return;
      var d = new AM_FilterNameDialog("AutoMosaic - Rename filter", [], g.name);
      if (!d.execute()) return;
      var other = AM.Inputs.findGroup(self.groups, d.name);
      if (other && other !== g) {
         for (var i = 0; i < g.panels.length; ++i) other.addPanel(g.panels[i]);
         self.groups.splice(self.groups.indexOf(g), 1);
      } else {
         g.name = d.name;
         for (var j = 0; j < g.panels.length; ++j) g.panels[j].filter = d.name;
      }
      self.refreshTree();
   });

   var clearBtn = button("Clear", "Remove all panels.", function() { self.groups.length = 0; self.refreshTree(); });

   var buttons1 = new HorizontalSizer;
   buttons1.spacing = 6;
   buttons1.add(addFiles); buttons1.add(addFolder); buttons1.add(addWindows);
   buttons1.addSpacing(12);
   buttons1.add(upBtn); buttons1.add(downBtn);
   buttons1.addStretch();
   var buttons2 = new HorizontalSizer;
   buttons2.spacing = 6;
   buttons2.add(removeBtn); buttons2.add(moveBtn); buttons2.add(renameBtn); buttons2.add(clearBtn);
   buttons2.addStretch();

   // ---- options ------------------------------------------------------------
   function labelOf(text)
   {
      var l = new Label(self);
      l.text = text;
      l.textAlignment = TextAlign_Right | TextAlign_VertCenter;
      l.minWidth = labelWidth;
      return l;
   }

   this.solve_CheckBox = new CheckBox(this);
   this.solve_CheckBox.text = "Plate solve panels without astrometric data (opens ImageSolver)";
   this.solve_CheckBox.toolTip = "When a panel has no astrometric solution, PixInsight's own ImageSolver dialog opens on it so that you can " +
      "set its parameters; once solved, the mosaic starts by itself. A copy is solved: the original file is never modified.";
   var solveRow = new HorizontalSizer;
   solveRow.spacing = 4;
   solveRow.add(labelOf("Plate solving:"));
   solveRow.add(this.solve_CheckBox);
   solveRow.addStretch();

   this.solve_CheckBox.onClick = function() { self.updateAstrometryNotice(); };

   this.shared_CheckBox = new CheckBox(this);
   this.shared_CheckBox.text = "Shared geometry";
   this.shared_CheckBox.toolTip = "The mosaic geometry computed on the reference filter is reused for all the other filters, " +
      "so that the mosaics overlap pixel by pixel (needed for LRGB / SHO combinations).";
   this.reference_Combo = new ComboBox(this);
   this.reference_Combo.toolTip = "Filter whose geometry is shared (Automatic: L if present, otherwise the first filter).";
   this.shared_CheckBox.onClick = function() { self.reference_Combo.enabled = self.shared_CheckBox.checked; };
   var sharedRow = new HorizontalSizer;
   sharedRow.spacing = 4;
   sharedRow.add(labelOf("Geometry:"));
   sharedRow.add(this.shared_CheckBox);
   sharedRow.addSpacing(12);
   var refLabel = new Label(this);
   refLabel.text = "Reference filter:";
   refLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   sharedRow.add(refLabel);
   sharedRow.add(this.reference_Combo);
   sharedRow.addStretch();

   this.refreshReferenceCombo = function()
   {
      var wanted = self.reference_Combo.currentItem > 0 ? self.reference_Combo.itemText(self.reference_Combo.currentItem)
                                                         : self.opts.referenceFilter;
      self.reference_Combo.clear();
      self.reference_Combo.addItem("Automatic");
      var sel = 0;
      for (var i = 0; i < self.groups.length; ++i) {
         self.reference_Combo.addItem(self.groups[i].name);
         if (self.groups[i].name === wanted) sel = i + 1;
      }
      self.reference_Combo.currentItem = sel;
   };

   this.recurse_CheckBox = new CheckBox(this);
   this.recurse_CheckBox.text = "Include subfolders (Add Folder)";
   var checksRow = new HorizontalSizer;
   checksRow.spacing = 12;
   checksRow.addSpacing(labelWidth + 4);
   checksRow.add(this.recurse_CheckBox);
   checksRow.addStretch();

   this.cropRot_CheckBox = new CheckBox(this);
   this.cropRot_CheckBox.text = "Optimise crop rotation";
   this.cropRot_CheckBox.toolTip = "Allow a rotated crop rectangle (keeps more image; the mosaics are resampled once with Lanczos-3). " +
      "If the gain is below 0.5% an axis-aligned crop is used instead.";
   var cropRow = new HorizontalSizer;
   cropRow.spacing = 12;
   cropRow.addSpacing(labelWidth + 4);
   cropRow.add(this.cropRot_CheckBox);
   cropRow.addStretch();

   var optionsGroup = new GroupBox(this);
   optionsGroup.title = "Options";
   optionsGroup.sizer = new VerticalSizer;
   optionsGroup.sizer.margin = 6;
   optionsGroup.sizer.spacing = 6;
   optionsGroup.sizer.add(solveRow);
   optionsGroup.sizer.add(sharedRow);
   optionsGroup.sizer.add(checksRow);
   optionsGroup.sizer.add(cropRow);

   // ---- execution ----------------------------------------------------------
   this.serial_Radio = new RadioButton(this);
   this.serial_Radio.text = "Sequential";
   this.serial_Radio.toolTip = "Filters are processed one after the other in this PixInsight instance.";
   this.parallel_Radio = new RadioButton(this);
   this.parallel_Radio.text = "Parallel (experimental)";
   this.maxInst_Spin = new SpinBox(this);
   this.maxInst_Spin.minValue = 2;
   this.maxInst_Spin.maxValue = 8;
   var instLabel = new Label(this);
   instLabel.text = "Max instances:";
   instLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   this.parallel_Radio.enabled = AM.PARALLEL_AVAILABLE === true;
   this.maxInst_Spin.enabled = AM.PARALLEL_AVAILABLE === true;
   this.parallel_Radio.toolTip = AM.PARALLEL_AVAILABLE === true ?
      "Each filter runs in its own PixInsight instance (needs a lot of RAM). The reference filter is processed first." :
      "Not available: " + (AM.PARALLEL_REASON || "see the README");
   var execRow = new HorizontalSizer;
   execRow.spacing = 12;
   execRow.add(this.serial_Radio);
   execRow.add(this.parallel_Radio);
   execRow.add(instLabel);
   execRow.add(this.maxInst_Spin);
   execRow.addStretch();
   var execGroup = new GroupBox(this);
   execGroup.title = "Execution";
   execGroup.sizer = new VerticalSizer;
   execGroup.sizer.margin = 6;
   execGroup.sizer.add(execRow);

   // ---- result -------------------------------------------------------------
   // Nothing is saved by default: the cropped mosaics are opened in PixInsight.
   var check = function(text, tip)
   {
      var c = new CheckBox(self);
      c.text = text; c.toolTip = tip;
      return c;
   };
   this.openCrop_CheckBox = check("Open cropped mosaic", "Open the cropped mosaic of each filter in PixInsight (default). " +
      "ONE crop, common to all filters, is applied: the largest rectangle without empty pixels.");
   this.openFull_CheckBox = check("Open uncropped mosaic", "Open the full (uncropped) mosaic of each filter in PixInsight.");
   this.save_CheckBox = check("Save to folder", "Also write the mosaics to a folder (Mosaic_<filter>.xisf, Mosaic_<filter>_crop.xisf). " +
      "Without this option no file is written anywhere.");
   this.saveCrop_CheckBox = check("Cropped", "Save the cropped mosaics.");
   this.saveFull_CheckBox = check("Uncropped", "Save the uncropped mosaics.");
   this.solveMosaic_CheckBox = check("Plate solve the mosaics (ImageSolver)", "For each mosaic delivered (cropped and/or uncropped), " +
      "PixInsight's ImageSolver dialog opens so that you can set it up; the solution is written into the opened mosaic and into the saved files. " +
      "If the solve fails, the mosaic is still delivered and the failure is reported. Untick to skip the plate solving of the mosaics.");
   this.overwrite_CheckBox = check("Overwrite existing files", "If off, the run stops before starting when a file to be saved already exists.");
   this.output_Edit = new Edit(this);
   this.output_Edit.toolTip = "Folder where the mosaics are saved";
   this.outBrowse = new ToolButton(this);
   this.outBrowse.icon = this.scaledResource(":/browser/select-file.png");
   this.outBrowse.setScaledFixedSize(22, 22);
   this.outBrowse.toolTip = "Choose the folder";
   this.outBrowse.onClick = function()
   {
      var d = new GetDirectoryDialog();
      d.caption = "AutoMosaic - Output folder";
      if (self.output_Edit.text) d.initialPath = self.output_Edit.text;
      if (d.execute()) self.output_Edit.text = d.directory;
   };
   this.updateResultControls = function()
   {
      var sv = self.save_CheckBox.checked;
      self.saveCrop_CheckBox.enabled = self.saveFull_CheckBox.enabled = self.overwrite_CheckBox.enabled = sv;
      self.output_Edit.enabled = self.outBrowse.enabled = sv;
      self.cropRot_CheckBox.enabled = self.openCrop_CheckBox.checked || (sv && self.saveCrop_CheckBox.checked);
   };
   this.openCrop_CheckBox.onClick = this.openFull_CheckBox.onClick = this.save_CheckBox.onClick =
      this.saveCrop_CheckBox.onClick = this.saveFull_CheckBox.onClick = function() { self.updateResultControls(); };

   var openRow = new HorizontalSizer;
   openRow.spacing = 12;
   openRow.add(this.openCrop_CheckBox);
   openRow.add(this.openFull_CheckBox);
   openRow.add(this.solveMosaic_CheckBox);
   openRow.addStretch();
   var saveRow = new HorizontalSizer;
   saveRow.spacing = 12;
   saveRow.add(this.save_CheckBox);
   saveRow.add(this.saveCrop_CheckBox);
   saveRow.add(this.saveFull_CheckBox);
   saveRow.add(this.overwrite_CheckBox);
   saveRow.addStretch();
   var folderRow = new HorizontalSizer;
   folderRow.spacing = 4;
   folderRow.add(this.output_Edit, 100);
   folderRow.add(this.outBrowse);
   var resultGroup = new GroupBox(this);
   resultGroup.title = "Result";
   resultGroup.sizer = new VerticalSizer;
   resultGroup.sizer.margin = 6;
   resultGroup.sizer.spacing = 6;
   resultGroup.sizer.add(openRow);
   resultGroup.sizer.add(saveRow);
   resultGroup.sizer.add(folderRow);

   // ---- bottom buttons -----------------------------------------------------
   this.newInstance_Button = new ToolButton(this);
   this.newInstance_Button.icon = this.scaledResource(":/process-interface/new-instance.png");
   this.newInstance_Button.setScaledFixedSize(24, 24);
   this.newInstance_Button.toolTip = "Drag to the workspace to create a process icon with the current state.";
   this.newInstance_Button.onMousePress = function()
   {
      self.readControls();
      AM.State.toParameters(self.groups, self.opts);
      this.hasFocus = true;
      this.pushed = false;
      self.newInstance();
   };

   // Automatic astrometry check before running. Returns false when the user cancels or the run is impossible.
   this.confirmAstrometry = function()
   {
      var miss = self.panelsWithoutSolution();
      if (miss.length === 0) return true;
      var esc = function(t) { return ("" + t).replace(/&/g, "&amp;").replace(/</g, "&lt;"); };
      if (!self.opts.solve) {
         var r = (new MessageBox("<p>" + miss.length + " panel(s) have no astrometric data and plate solving is switched off, " +
            "so the mosaic cannot be built.</p><p>Solve them with ImageSolver now?</p>",
            AM.TITLE, StdIcon_Question, StdButton_Yes, StdButton_No)).execute();
         if (r !== StdButton_Yes) return false;
         self.solve_CheckBox.checked = true;
         self.opts.solve = true;
         self.updateAstrometryNotice();
      }
      var chk = AM.checkTool("ImageSolver");
      if (!chk.ok) {
         (new MessageBox("<p>Plate solving needs PixInsight's ImageSolver script, which is not usable:</p><p>" + esc(chk.message) + "</p>",
            AM.TITLE, StdIcon_Error, StdButton_Ok)).execute();
         return false;
      }
      var lines = [];
      for (var i = 0; i < miss.length; ++i) lines.push("&bull; " + esc(miss[i].name));
      var a = (new MessageBox("<p><b>" + miss.length + " panel(s) have no astrometric data:</b></p><p>" + lines.join("<br/>") +
         "</p><p>The ImageSolver dialog will open for each of them (a copy is solved, the originals are not modified); " +
         "when they are all solved the mosaic starts by itself.</p>",
         AM.TITLE, StdIcon_Information, StdButton_Ok, StdButton_Cancel)).execute();
      return a === StdButton_Ok;
   };

   this.run_Button = new PushButton(this);
   this.run_Button.text = "Run";
   this.run_Button.defaultButton = true;
   this.run_Button.icon = this.scaledResource(":/icons/power.png");
   this.run_Button.onClick = function()
   {
      self.readControls();
      var problems = [];
      var o = self.opts;
      if (!o.openCropped && !o.openUncropped && !o.saveFiles)
         problems.push("Nothing to do with the result: tick 'Open cropped mosaic', 'Open uncropped mosaic' or 'Save to folder'.");
      if (o.saveFiles) {
         if (!o.outputDir) problems.push("Choose the folder where the mosaics are saved.");
         if (!o.saveCropped && !o.saveUncropped) problems.push("Saving is on: tick 'Cropped' and/or 'Uncropped'.");
      }
      problems = problems.concat(AM.Inputs.validate(self.groups));
      if (problems.length > 0) {
         (new MessageBox("<p>" + problems.join("</p><p>") + "</p>", AM.TITLE, StdIcon_Warning, StdButton_Ok)).execute();
         return;
      }
      if (!self.confirmAstrometry()) return;
      self.ok();
   };
   this.cancel_Button = new PushButton(this);
   this.cancel_Button.text = "Cancel";
   this.cancel_Button.icon = this.scaledResource(":/icons/cancel.png");
   this.cancel_Button.onClick = function() { self.cancel(); };

   var bottom = new HorizontalSizer;
   bottom.spacing = 6;
   bottom.add(this.newInstance_Button);
   bottom.addStretch();
   bottom.add(this.run_Button);
   bottom.add(this.cancel_Button);

   // ---- layout -------------------------------------------------------------
   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 6;
   this.sizer.add(title);
   this.sizer.add(this.tree, 100);
   this.sizer.add(this.warn_Label);
   this.sizer.add(buttons1);
   this.sizer.add(buttons2);
   this.sizer.add(optionsGroup);
   this.sizer.add(execGroup);
   this.sizer.add(resultGroup);
   this.sizer.add(bottom);

   this.windowTitle = AM.TITLE + " " + AM.VERSION;
   this.userResizable = true;
   this.adjustToContents();

   // ---- state <-> controls -------------------------------------------------
   this.writeControls = function()
   {
      var o = self.opts;
      self.solve_CheckBox.checked = o.solve;
      self.shared_CheckBox.checked = o.sharedGeometry;
      self.reference_Combo.enabled = o.sharedGeometry;
      self.recurse_CheckBox.checked = o.recurse;
      self.cropRot_CheckBox.checked = o.cropRotation;
      self.solveMosaic_CheckBox.checked = o.solveMosaic;
      self.openCrop_CheckBox.checked = o.openCropped;
      self.openFull_CheckBox.checked = o.openUncropped;
      self.save_CheckBox.checked = o.saveFiles;
      self.saveCrop_CheckBox.checked = o.saveCropped;
      self.saveFull_CheckBox.checked = o.saveUncropped;
      self.overwrite_CheckBox.checked = o.overwrite;
      self.serial_Radio.checked = !(o.execution === "parallel" && AM.PARALLEL_AVAILABLE === true);
      self.parallel_Radio.checked = !self.serial_Radio.checked;
      self.maxInst_Spin.value = Math.max(2, Math.min(8, o.maxInstances));
      self.output_Edit.text = o.outputDir;
      self.updateResultControls();
      self.refreshTree();
   };

   this.readControls = function()
   {
      var o = self.opts;
      o.solve = self.solve_CheckBox.checked;
      o.sharedGeometry = self.shared_CheckBox.checked;
      o.referenceFilter = self.reference_Combo.currentItem > 0 ? self.reference_Combo.itemText(self.reference_Combo.currentItem) : "";
      o.recurse = self.recurse_CheckBox.checked;
      o.cropRotation = self.cropRot_CheckBox.checked;
      o.solveMosaic = self.solveMosaic_CheckBox.checked;
      o.openCropped = self.openCrop_CheckBox.checked;
      o.openUncropped = self.openFull_CheckBox.checked;
      o.saveFiles = self.save_CheckBox.checked;
      o.saveCropped = self.saveCrop_CheckBox.checked;
      o.saveUncropped = self.saveFull_CheckBox.checked;
      o.overwrite = self.overwrite_CheckBox.checked;
      o.execution = self.parallel_Radio.checked ? "parallel" : "serial";
      o.maxInstances = self.maxInst_Spin.value;
      o.outputDir = AM.normPath(("" + self.output_Edit.text).replace(/^\s+|\s+$/g, ""));
   };

   this.onShow = function() { self.writeControls(); };
}
AM_Dialog.prototype = new Dialog;
