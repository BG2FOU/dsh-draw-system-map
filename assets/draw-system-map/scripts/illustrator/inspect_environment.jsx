#target illustrator
(function () {
    var output = File.saveDialog("Save Illustrator environment and PostScript font names", "*.txt");
    if (!output) { return; }
    var lines = ["Illustrator: " + app.version, "OS: " + $.os,
                 "Font PostScript name\tFamily\tStyle"];
    for (var i = 0; i < app.textFonts.length; i++) {
        var font = app.textFonts[i];
        lines.push(font.name + "\t" + font.family + "\t" + font.style);
    }
    output.encoding = "UTF-8";
    if (!output.open("w")) { throw new Error("Cannot write environment report"); }
    output.write(lines.join("\n"));
    output.close();
    alert("Environment report saved. No documents were changed.");
}());
