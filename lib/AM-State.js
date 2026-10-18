// AM-State.js - persistence of the options (Settings) and of the whole state
// (Parameters, i.e. process icons / saved instances).

AM.State = {};

AM.State._optionKeys = ["solve", "sharedGeometry", "referenceFilter", "openCropped", "openUncropped", "saveFiles", "saveCropped",
                        "saveUncropped", "outputDir", "overwrite", "execution", "maxInstances", "recurse", "cropRotation", "cropMargin"];

AM.State.loadOptions = function()
{
   var opts = AM.defaultOptions();
   try {
      var json = Settings.read(AM.SETTINGS_KEY + "/options", DataType_UCString);
      if (Settings.lastReadOK && json) {
         var o = JSON.parse(json);
         for (var i = 0; i < AM.State._optionKeys.length; ++i) {
            var k = AM.State._optionKeys[i];
            if (o[k] !== undefined && typeof o[k] === typeof opts[k]) opts[k] = o[k];
         }
      }
   } catch (e) {}
   return opts;
};

AM.State.saveOptions = function(opts)
{
   try { Settings.write(AM.SETTINGS_KEY + "/options", DataType_UCString, JSON.stringify(opts)); } catch (e) {}
};

AM.State._groupsToList = function(groups)
{
   var list = [];
   for (var i = 0; i < groups.length; ++i)
      for (var j = 0; j < groups[i].panels.length; ++j)
         list.push({ filter: groups[i].name, path: groups[i].panels[j].path, view: groups[i].panels[j].sourceViewId });
   return list;
};

AM.State._listToGroups = function(list)
{
   var groups = [];
   for (var i = 0; i < list.length; ++i) {
      var it = list[i];
      if (!File.exists(it.path)) continue;
      var p = AM.Inputs.makePanel(it.path);
      p.sourceViewId = it.view || "";
      var g = AM.Inputs.findGroup(groups, it.filter);
      if (!g) { g = new AM.FilterGroup(it.filter); groups.push(g); }
      g.addPanel(p);
   }
   return groups;
};

// Saves options and panels into the instance parameters.
AM.State.toParameters = function(groups, opts)
{
   Parameters.clear();
   Parameters.set("options", JSON.stringify(opts));
   Parameters.set("panels", JSON.stringify(AM.State._groupsToList(groups)));
};

// Returns { groups, opts } when the script was started from a saved instance, else null.
AM.State.fromParameters = function()
{
   try {
      if (!Parameters.has("options")) return null;
      var opts = AM.defaultOptions();
      var o = JSON.parse(Parameters.getString("options"));
      for (var k in o) if (opts[k] !== undefined) opts[k] = o[k];
      var groups = Parameters.has("panels") ? AM.State._listToGroups(JSON.parse(Parameters.getString("panels"))) : [];
      return { groups: groups, opts: opts };
   } catch (e) {
      return null;
   }
};
