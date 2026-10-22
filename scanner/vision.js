(function(scope) {
  "use strict";
  const W = 256, H = 360, U = [15, 15, 15, 15, 14, 14, 14, 13, 13, 12, 11, 10, 9, 8, 6, 3, 0];
  function angle(g, x, y) {
    let a = 0, b = 0, k = y * g.cols + x, s = g.cols, d = g.data;
    for (let u = -15; u <= 15; u++) a += u * d[k + u];
    for (let v = 1; v <= 15; v++) {
      let z = 0;
      for (let u = -U[v]; u <= U[v]; u++) {
        let p = d[k + u + v * s], m = d[k + u - v * s];
        z += p - m;
        a += u * (p + m);
      }
      b += v * z;
    }
    return Math.atan2(b, a);
  }
  function features(rgba, w = W, h = H, limit = 220) {
    let gray = new jsfeat.matrix_t(w, h, jsfeat.U8_t | jsfeat.C1_t);
    jsfeat.imgproc.grayscale(rgba, w, h, gray);
    let smooth = new jsfeat.matrix_t(w, h, jsfeat.U8_t | jsfeat.C1_t);
    jsfeat.imgproc.gaussian_blur(gray, smooth, 5, 0);
    let kp = Array.from({ length: w * h }, () => new jsfeat.keypoint_t(0, 0, 0, 0));
    jsfeat.yape06.laplacian_threshold = 20;
    jsfeat.yape06.min_eigen_value_threshold = 15;
    let n = jsfeat.yape06.detect(smooth, kp, 18);
    kp = kp.slice(0, n).sort((a, b) => b.score - a.score);
    const cells = new Uint8Array(16), selected = [];
    for (const p of kp) {
      let i = Math.min(3, p.x / w * 4 | 0) + 4 * Math.min(3, p.y / h * 4 | 0);
      if (cells[i] >= Math.ceil(limit / 12)) continue;
      cells[i]++;
      p.angle = angle(smooth, p.x, p.y);
      selected.push(p);
      if (selected.length >= limit) break;
    }
    let desc = new jsfeat.matrix_t(32, Math.max(1, selected.length), jsfeat.U8_t | jsfeat.C1_t);
    if (selected.length) jsfeat.orb.describe(smooth, selected, selected.length, desc);
    return { xy: selected.flatMap((p) => [p.x, p.y]), desc: new Uint8Array(desc.data.slice(0, selected.length * 32)) };
  }
  function pop(n) {
    n -= n >>> 1 & 1431655765;
    n = (n & 858993459) + (n >>> 2 & 858993459);
    return (n + (n >>> 4) & 252645135) * 16843009 >>> 24;
  }
  function distance(a, ao, b, bo) {
    let n = 0;
    for (let i = 0; i < 8; i++) n += pop(a[ao + i] ^ b[bo + i]);
    return n;
  }
  function homography(a, b) {
    const m = new jsfeat.matrix_t(3, 3, jsfeat.F32_t | jsfeat.C1_t);
    const ok = new jsfeat.motion_model.homography2d().run(a, b, m, 4);
    return ok ? Array.from(m.data).slice(0, 9) : null;
  }
  function warp(src, w, h, corners, ow = W, oh = H) {
    let a = [{ x: 0, y: 0 }, { x: ow - 1, y: 0 }, { x: ow - 1, y: oh - 1 }, { x: 0, y: oh - 1 }], m = homography(a, corners);
    if (!m) throw Error("Esquinas inv\xE1lidas");
    let out = new Uint8ClampedArray(ow * oh * 4);
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
      let z = m[6] * x + m[7] * y + m[8], sx = (m[0] * x + m[1] * y + m[2]) / z, sy = (m[3] * x + m[4] * y + m[5]) / z;
      let ix = Math.max(0, Math.min(w - 2, Math.floor(sx))), iy = Math.max(0, Math.min(h - 2, Math.floor(sy))), dx = Math.max(0, Math.min(1, sx - ix)), dy = Math.max(0, Math.min(1, sy - iy)), i = (y * ow + x) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = src[(iy * w + ix) * 4 + c] * (1 - dx) * (1 - dy) + src[(iy * w + ix + 1) * 4 + c] * dx * (1 - dy) + src[((iy + 1) * w + ix) * 4 + c] * (1 - dx) * dy + src[((iy + 1) * w + ix + 1) * 4 + c] * dx * dy;
      out[i + 3] = 255;
    }
    return out;
  }
  function area(p) {
    return Math.abs(p.reduce((s, a, i) => {
      let b = p[(i + 1) % 4];
      return s + a.x * b.y - a.y * b.x;
    }, 0)) / 2;
  }
  function detect(rgba, w, h) {
    let gray = new jsfeat.matrix_t(w, h, jsfeat.U8_t | jsfeat.C1_t), blur = new jsfeat.matrix_t(w, h, jsfeat.U8_t | jsfeat.C1_t), edges = new jsfeat.matrix_t(w, h, jsfeat.U8_t | jsfeat.C1_t);
    jsfeat.imgproc.grayscale(rgba, w, h, gray);
    jsfeat.imgproc.gaussian_blur(gray, blur, 5, 0);
    jsfeat.imgproc.canny(blur, edges, 25, 70);
    let seen = new Uint8Array(w * h), queue = new Int32Array(w * h), best = null, score = 0;
    for (let start = 0; start < w * h; start++) {
      if (seen[start] || !edges.data[start]) continue;
      let head = 0, tail = 1;
      queue[0] = start;
      seen[start] = 1;
      let tl = { x: w, y: h }, tr = { x: 0, y: h }, br = { x: 0, y: 0 }, bl = { x: w, y: 0 };
      while (head < tail) {
        let p2 = queue[head++], x = p2 % w, y = p2 / w | 0;
        if (x + y < tl.x + tl.y) tl = { x, y };
        if (x - y > tr.x - tr.y) tr = { x, y };
        if (x + y > br.x + br.y) br = { x, y };
        if (y - x > bl.y - bl.x) bl = { x, y };
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          let nx = x + dx, ny = y + dy;
          if (nx < 2 || ny < 2 || nx >= w - 2 || ny >= h - 2) continue;
          let i = ny * w + nx;
          if (!seen[i] && edges.data[i]) {
            seen[i] = 1;
            queue[tail++] = i;
          }
        }
      }
      let p = [tl, tr, br, bl], ar = area(p), width = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2, height = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2, ratio = width / height;
      if (tail > 100 && ar > w * h * 0.14 && ar < w * h * 0.97 && ratio > 0.46 && ratio < 1 && ar > score) {
        score = ar;
        best = p;
      }
    }
    return best;
  }
  scope.CardVision = { W, H, features, distance, homography, warp, detect, area };
})(typeof self !== "undefined" ? self : globalThis);
