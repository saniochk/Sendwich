// Sendwich - (c) 2026 Saniochk. MIT License, see LICENSE.
// Dot-matrix status animations: Lottie files in /anim (wait.json, build.json), replaceable with any Lottie JSON.
window.VBAnim = (function () {
  var anims = {}, current = null, host = null, ext = "";
  function init(container, extPath) { host = container; ext = extPath; }
  function load(name) {
    if (anims[name] !== undefined) return anims[name];
    anims[name] = null;
    try {
      var r = window.cep && window.cep.fs.readFile(ext + "/anim/" + name + ".json");
      if (r && r.err === 0 && window.lottie && host) {
        var box = document.createElement("div");
        box.className = "lottie"; box.hidden = true; host.appendChild(box);
        anims[name] = { box: box, a: lottie.loadAnimation({ container: box, renderer: "svg", loop: true, autoplay: false,
          animationData: JSON.parse(r.data), rendererSettings: { preserveAspectRatio: "xMinYMid slice" } }) };
      }
    } catch (e) {}
    return anims[name];
  }
  function play(name) {
    if (current === name) return;
    for (var k in anims) if (anims.hasOwnProperty(k) && anims[k]) { anims[k].a.stop(); anims[k].box.hidden = true; }
    current = name || null;
    var a = name ? load(name) : null;
    if (a) { a.box.hidden = false; a.a.play(); }
    return !!a;
  }
  return { init: init, load: load, play: play };
})();
