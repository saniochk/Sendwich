// Sendwich - (c) 2026 Saniochk. MIT License, see LICENSE.
// Dot-matrix status animations: Lottie files in /anim (wait.json, build.json), replaceable with any Lottie JSON.
window.VBAnim = (function () {
  var anims = {}, current = null, host = null, ext = "", fs = null;
  function init(container, extPath, fileSystem) { host = container; ext = extPath; fs = fileSystem; }
  function load(name) {
    if (anims[name] !== undefined || !fs) return;
    anims[name] = null;
    fs.readFile(ext + "/anim/" + name + ".json", "utf8", function (err, data) {
      if (err || !window.lottie || !host) return;
      try {
        var box = document.createElement("div");
        box.className = "lottie"; box.hidden = current !== name; host.appendChild(box);
        anims[name] = { box: box, a: lottie.loadAnimation({ container: box, renderer: "svg", loop: true, autoplay: false,
          animationData: JSON.parse(data), rendererSettings: { preserveAspectRatio: "xMinYMid slice" } }) };
        if (current === name) anims[name].a.play();
      } catch (e) {}
    });
  }
  function play(name) {
    if (current === name) return;
    for (var k in anims) if (anims.hasOwnProperty(k) && anims[k]) { anims[k].a.stop(); anims[k].box.hidden = true; }
    current = name || null;
    if (name) load(name);
    var a = name ? anims[name] : null;
    if (a) { a.box.hidden = false; a.a.play(); }
    return !!a;
  }
  return { init: init, load: load, play: play };
})();
