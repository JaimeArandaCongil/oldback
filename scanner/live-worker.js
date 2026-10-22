self.window = self;
importScripts("./jsfeat.js", "./vision.js", "./quality.js");
let previous = null, ticks = 0;
onmessage = (e) => {
  if (e.data.type !== "frame") return;
  const start = performance.now();
  try {
    const { rgba, w, h } = e.data, p = CardVision.detect(rgba, w, h), quad = p?.map((a) => ({ x: a.x / w, y: a.y / h }));
    let motion = 1;
    if (quad && previous) motion = quad.reduce((s, a, i) => s + Math.hypot(a.x - previous[i].x, a.y - previous[i].y), 0) / 4;
    ticks = quad ? motion < 0.018 ? ticks + 1 : 1 : 0;
    previous = quad || null;
    let data = rgba, mw = w, mh = h;
    if (p) {
      mw = 160;
      mh = 224;
      data = CardVision.warp(rgba, w, h, p, mw, mh);
    }
    const metrics = CardQuality.metrics(data, mw, mh), stable = ticks >= 3, area = p ? CardVision.area(p) / (w * h) : 0;
    postMessage({ type: "frame", quad: quad || null, stable, motion, metrics, area, advice: CardQuality.advice(metrics, p, stable, motion, area), ms: performance.now() - start });
  } catch {
    postMessage({ type: "unavailable" });
  }
};
