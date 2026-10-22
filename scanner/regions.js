(function(scope) {
  "use strict";
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const area = (p) => Math.abs(p.reduce((s, a, i) => {
    const b = p[(i + 1) % p.length];
    return s + a.x * b.y - a.y * b.x;
  }, 0)) / 2;
  function hull(points) {
    const p = points.sort((a, b) => a.x - b.x || a.y - b.y), lower = [], upper = [];
    for (const v of p) {
      while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), v) <= 0) lower.pop();
      lower.push(v);
    }
    for (let i = p.length - 1; i >= 0; i--) {
      const v = p[i];
      while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), v) <= 0) upper.pop();
      upper.push(v);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }
  function quadrilateral(points) {
    const p = hull(points);
    if (p.length < 4) return null;
    while (p.length > 4) {
      let index = 0, smallest = Infinity;
      for (let i = 0; i < p.length; i++) {
        const cost = Math.abs(cross(p[(i + p.length - 1) % p.length], p[i], p[(i + 1) % p.length]));
        if (cost < smallest) {
          smallest = cost;
          index = i;
        }
      }
      p.splice(index, 1);
    }
    return p;
  }
  function valid(p, w, h, min = 0.012) {
    if (!Array.isArray(p) || p.length !== 4 || p.some((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y) || v.x < 0 || v.y < 0 || v.x > w || v.y > h)) return false;
    return p.every((v, i) => cross(v, p[(i + 1) % 4], p[(i + 2) % 4]) > 0) && area(p) > w * h * min;
  }
  function orient(p) {
    const lengths = p.map((a, i2) => Math.hypot(a.x - p[(i2 + 1) % 4].x, a.y - p[(i2 + 1) % 4].y));
    const parity = lengths[0] + lengths[2] < lengths[1] + lengths[3] ? 0 : 1;
    const i = p[parity].y + p[(parity + 1) % 4].y < p[(parity + 2) % 4].y + p[(parity + 3) % 4].y ? parity : (parity + 2) % 4;
    return p.map((_, n) => ({ ...p[(i + n) % 4] }));
  }
  function intersection(subject, clip) {
    let out = subject;
    for (let i = 0; i < clip.length; i++) {
      const a = clip[i], b = clip[(i + 1) % clip.length], input = out;
      out = [];
      if (!input.length) break;
      for (let j = 0; j < input.length; j++) {
        const p = input[j], q = input[(j + 1) % input.length], cp = cross(a, b, p), cq = cross(a, b, q), inside = cp >= 0, next = cq >= 0;
        if (inside) out.push(p);
        if (inside !== next) {
          const t = cp / (cp - cq);
          out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        }
      }
    }
    return out.length > 2 ? area(out) : 0;
  }
  function overlap(a, b) {
    const common = intersection(a, b), aa = area(a), bb = area(b);
    return { iou: common / (aa + bb - common || 1), contained: common / (Math.min(aa, bb) || 1) };
  }
  function detect(rgba, w, h, { limit = 4 } = {}) {
    const gray = new jsfeat.matrix_t(w, h, jsfeat.U8_t | jsfeat.C1_t), blur = new jsfeat.matrix_t(w, h, jsfeat.U8_t | jsfeat.C1_t), edges = new jsfeat.matrix_t(w, h, jsfeat.U8_t | jsfeat.C1_t);
    jsfeat.imgproc.grayscale(rgba, w, h, gray);
    jsfeat.imgproc.gaussian_blur(gray, blur, 5, 0);
    const found = [], seen = new Uint8Array(w * h), queue = new Int32Array(w * h);
    for (const [low, high] of [[25, 70], [45, 120], [0, 0]]) {
      if (low) jsfeat.imgproc.canny(blur, edges, low, high);
      else {
        const mask = new Uint8Array(w * h);
        for (let i = 0; i < mask.length; i++) {
          const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
          mask[i] = r > 110 && g > 85 && b < Math.min(r, g) * 0.82 && r > g * 0.85 && r < g * 2 ? 255 : 0;
        }
        edges.data.fill(0);
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (mask[i + dy * w + dx]) edges.data[i] = 255;
        }
      }
      seen.fill(0);
      for (let start = 0; start < w * h; start++) {
        if (seen[start] || !edges.data[start]) continue;
        let head = 0, tail = 1;
        queue[0] = start;
        seen[start] = 1;
        while (head < tail) {
          const p2 = queue[head++], x = p2 % w, y = p2 / w | 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const n = ny * w + nx;
            if (!seen[n] && edges.data[n]) {
              seen[n] = 1;
              queue[tail++] = n;
            }
          }
        }
        if (tail < 70) continue;
        const points = [], step = Math.max(1, Math.floor(tail / 2e4));
        for (let j = 0; j < tail; j += step) points.push({ x: queue[j] % w, y: queue[j] / w | 0 });
        const p = quadrilateral(points);
        if (!valid(p, w, h) || area(p) > w * h * 0.85) continue;
        const lens = p.map((a, i) => Math.hypot(a.x - p[(i + 1) % 4].x, a.y - p[(i + 1) % 4].y)), short = Math.min(lens[0] + lens[2], lens[1] + lens[3]) / 2, long = Math.max(lens[0] + lens[2], lens[1] + lens[3]) / 2, ratio = short / long;
        if (short < 35 || ratio < 0.52 || ratio > 0.86) continue;
        if (p.some((a, i) => {
          const b = p[(i + 1) % 4], c = p[(i + 2) % 4];
          return Math.abs(((a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y)) / (lens[i] * lens[(i + 1) % 4])) > 0.55;
        })) continue;
        found.push({ corners: orient(p), score: area(p) * (1 - Math.abs(ratio - 63 / 88)) });
      }
    }
    const kept = [];
    for (const r of found.sort((a, b) => b.score - a.score)) {
      if (kept.some((v) => {
        const o = overlap(r.corners, v.corners);
        return o.iou > 0.4 || o.contained > 0.8;
      })) continue;
      kept.push(r);
    }
    const overflow = kept.length > limit;
    return { regions: kept.slice(0, limit).sort((a, b) => {
      const ac = a.corners.reduce((n, p) => n + p.y, 0) / 4, bc = b.corners.reduce((n, p) => n + p.y, 0) / 4;
      return Math.abs(ac - bc) < h * 0.12 ? a.corners[0].x - b.corners[0].x : ac - bc;
    }).map((r) => r.corners), overflow };
  }
  scope.CardRegions = { area, valid, orient, overlap, detect };
})(typeof self !== "undefined" ? self : globalThis);
