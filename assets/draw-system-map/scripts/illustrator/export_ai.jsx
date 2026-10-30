/* Native Illustrator bridge. Run the generated run-export.jsx, not this library.
 * Requires Illustrator desktop; Linux preparation/static checks are not native QA.
 */
function drawSystemMapJSON(value) {
    function quote(text) {
        return '"' + String(text).replace(/[\\"\x00-\x1f\u2028\u2029]/g, function (c) {
            var hex = c.charCodeAt(0).toString(16);
            return "\\u" + ("0000" + hex).slice(-4);
        }) + '"';
    }
    if (value === null) { return "null"; }
    if (typeof value === "string") { return quote(value); }
    if (typeof value === "number" || typeof value === "boolean") { return String(value); }
    var parts = [], i, key;
    if (value instanceof Array) {
        for (i = 0; i < value.length; i++) { parts.push(drawSystemMapJSON(value[i])); }
        return "[" + parts.join(",") + "]";
    }
    for (key in value) {
        if (value.hasOwnProperty(key)) { parts.push(quote(key) + ":" + drawSystemMapJSON(value[key])); }
    }
    return "{" + parts.join(",") + "}";
}

function drawSystemMapExport(job, root) {
    var target = null, imported = null, reopened = null;
    var original = app.documents.length ? app.activeDocument : null;
    var report = {status: "failed", illustrator: app.version, operating_system: $.os,
                  manual_review: "pending", fonts_requested: job.fonts, units: [], errors: []};
    var resultFile = new File(root.fsName + "/network.ai");
    var reportFile = new File(root.fsName + "/native-report.json");
    var candidate = new File(root.fsName + "/native-candidate-" + new Date().getTime() + ".ai");
    var completed = false;

    // Preserve prior native artwork AND evidence when an entry point is rerun.
    if (resultFile.exists || reportFile.exists) {
        alert("network.ai or native-report.json already exists. Prepare a new job directory; existing work was preserved.");
        return;
    }

    function require(condition, message) { if (!condition) { throw new Error(message); } }
    function fingerprint(text) { return String(text).replace(/\s/g, "").split("").sort().join(""); }
    function nativeStats(doc) {
        var names = [], fonts = {}, text = "", i, j;
        for (i = 0; i < doc.layers.length; i++) { names.push(doc.layers[i].name); }
        for (i = 0; i < doc.textFrames.length; i++) {
            var frame = doc.textFrames[i];
            text += frame.contents;
            // Inspect every character: a mixed-font frame can hide substitutions.
            for (j = 0; j < frame.characters.length; j++) {
                if (!/^\s*$/.test(frame.characters[j].contents)) {
                    fonts[frame.characters[j].characterAttributes.textFont.name] = true;
                }
            }
        }
        var fontNames = [];
        for (var name in fonts) { if (fonts.hasOwnProperty(name)) { fontNames.push(name); } }
        fontNames.sort();
        return {layers: names, paths: doc.pathItems.length, groups: doc.groupItems.length,
                text_frames: doc.textFrames.length, raster_items: doc.rasterItems.length,
                placed_items: doc.placedItems.length, fonts: fontNames,
                color_space: doc.documentColorSpace === DocumentColorSpace.RGB ? "RGB" : "CMYK",
                text_fingerprint: fingerprint(text)};
    }
    function assertNative(stats, expectedText) {
        require(stats.color_space === "RGB", "Native document color space is not RGB");
        require(stats.raster_items === 0 && stats.placed_items === 0, "Imported artwork contains raster/placed content");
        require(stats.text_fingerprint === fingerprint(expectedText), "Editable text characters differ from source");
        for (var i = 0; i < stats.fonts.length; i++) {
            var allowed = false;
            for (var j = 0; j < job.fonts.length; j++) { if (stats.fonts[i] === job.fonts[j]) { allowed = true; } }
            require(allowed, "Unexpected substituted font: " + stats.fonts[i]);
        }
    }
    function writeReport() {
        var file = reportFile;
        file.encoding = "UTF-8";
        require(file.open("w"), "Cannot write native-report.json");
        file.write(drawSystemMapJSON(report));
        file.close();
    }
    function closeOwned(doc) {
        if (doc) { try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (ignored) {} }
    }

    try {
        require(job.version === 1 && job.output === "network.ai", "Unsupported export job");
        require(job.units.length > 0 && job.fonts.length > 0, "Empty export job");
        require(!resultFile.exists, "network.ai already exists; use a new job directory");
        require(!candidate.exists, "Temporary native output already exists");
        for (var fi = 0; fi < job.fonts.length; fi++) {
            var font = app.textFonts.getByName(job.fonts[fi]);
            require(font.name === job.fonts[fi], "Missing requested font: " + job.fonts[fi]);
        }
        target = app.documents.add(DocumentColorSpace.RGB, job.width_points, job.height_points);
        target.artboards[0].artboardRect = [0, job.height_points, job.width_points, 0];
        var emptyLayer = target.layers[0];
        var layers = {}, expectedText = "";
        for (var ui = 0; ui < job.units.length; ui++) {
            var unit = job.units[ui];
            require(/^layers\/[0-9]+\.svg$/.test(unit.file), "Invalid import unit path");
            var source = new File(root.fsName + "/" + unit.file);
            require(source.exists, "Missing layer SVG: " + unit.file);
            imported = app.open(source, DocumentColorSpace.RGB);
            var board = imported.artboards[0].artboardRect;
            require(Math.abs(board[2] - board[0] - job.width_points) < 0.1 &&
                    Math.abs(board[1] - board[3] - job.height_points) < 0.1, "SVG artboard size changed: " + unit.file);
            var importedStats = nativeStats(imported);
            assertNative(importedStats, unit.text.join(""));
            var layerKey = "layer:" + unit.layer;
            if (!layers[layerKey]) {
                layers[layerKey] = target.layers.add(); // Later paint layers go on top.
                layers[layerKey].name = unit.layer;
            }
            var container = layers[layerKey].groupItems.add();
            container.name = unit.group;
            var copied = 0;
            // Illustrator pageItems uses front-to-back order. Duplicate back-to-front.
            for (var pi = imported.pageItems.length - 1; pi >= 0; pi--) {
                var item = imported.pageItems[pi];
                if (item.parent.typename !== "Layer") { continue; }
                var before = item.geometricBounds;
                var duplicate = item.duplicate(container, ElementPlacement.PLACEATBEGINNING);
                var after = duplicate.geometricBounds;
                duplicate.translate(before[0] - board[0] - after[0],
                                    before[1] + job.height_points - board[1] - after[1]);
                copied++;
            }
            require(copied > 0, "No editable objects imported from " + unit.file);
            expectedText += unit.text.join("");
            report.units.push({file: unit.file, layer: unit.layer, group: unit.group,
                               copied_top_objects: copied, native_paths: importedStats.paths,
                               native_text_frames: importedStats.text_frames});
            imported.close(SaveOptions.DONOTSAVECHANGES);
            imported = null;
        }
        if (emptyLayer.pageItems.length === 0) { emptyLayer.remove(); }
        var beforeSave = nativeStats(target);
        assertNative(beforeSave, expectedText);
        var options = new IllustratorSaveOptions();
        options.pdfCompatible = true;
        options.compressed = true;
        options.embedICCProfile = true;
        target.saveAs(candidate, options);
        target.close(SaveOptions.DONOTSAVECHANGES);
        target = null;
        require(candidate.exists && candidate.length > 0, "Native save did not produce a file");
        reopened = app.open(candidate);
        var afterSave = nativeStats(reopened);
        assertNative(afterSave, expectedText);
        require(drawSystemMapJSON(beforeSave) === drawSystemMapJSON(afterSave), "Native object structure changed after reopening");
        var reopenedBoard = reopened.artboards[0].artboardRect;
        require(Math.abs(reopenedBoard[2] - reopenedBoard[0] - job.width_points) < 0.1 &&
                Math.abs(reopenedBoard[1] - reopenedBoard[3] - job.height_points) < 0.1, "Reopened artboard size changed");
        reopened.close(SaveOptions.DONOTSAVECHANGES);
        reopened = null;
        require(!resultFile.exists, "Output appeared during export; refusing to overwrite it");
        require(candidate.rename("network.ai"), "Could not finalize native file");
        reopened = app.open(resultFile);
        report.status = "saved_and_reopened";
        report.output = "network.ai";
        report.native = afterSave;
        delete report.native.text_fingerprint;
        report.size_points = [job.width_points, job.height_points];
        writeReport();
        completed = true;
        reopened = null; // Leave the verified document open for manual review.
        alert("Saved and reopened network.ai. Manual visual and edit checks are still required. See native-report.json.");
    } catch (error) {
        report.status = "failed";
        report.errors.push(String(error));
        if (resultFile.exists) { report.output = "network.ai"; }
        else if (candidate.exists) { report.candidate = candidate.name; }
        try { writeReport(); } catch (reportError) { alert(String(reportError)); }
        alert("AI export not verified: " + String(error));
    } finally {
        closeOwned(imported);
        closeOwned(target);
        closeOwned(reopened);
        if (!completed && original) { try { app.activeDocument = original; } catch (ignored) {} }
    }
}
