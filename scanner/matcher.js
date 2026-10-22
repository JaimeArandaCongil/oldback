self.window = self;
importScripts("./jsfeat.js", "./vision.js", "./fusion.js");
let records, descriptors, lookup, featureCard;
const V = CardVision;
function key(d, o, t) {
  return d[o + t * 2] & 255 | (d[o + t * 2 + 1] & 255) << 8;
}
async function init(scope = "all") {
  const get = async (file) => {
    const r = await fetch("./" + file);
    if (!r.ok) throw Error("No se pudo descargar el \xEDndice");
    return r;
  };
  const index = await (await get("index.json")).json();
  const parts = index.version === 2 ? Object.entries(index.parts).filter(([era]) => scope === "all" || era === scope).map(([, p]) => p) : [{ meta: "index.json", bin: "features.bin" }];
  if (!parts.length) throw Error("Colecci\xF3n de esc\xE1ner no disponible");
  const loaded = await Promise.all(parts.map(async (p) => {
    const [m, b] = await Promise.all([get(p.meta).then((r) => r.json()), get(p.bin).then((r) => r.arrayBuffer())]);
    return { m, b };
  }));
  let offset = 0;
  records = [];
  const buffers = [];
  for (const { m, b } of loaded) {
    for (const r of m.cards) {
      if ((r.offset + r.count) * 32 > b.byteLength) throw Error("\xCDndice incompleto");
      records.push({ ...r, offset: r.offset + offset });
    }
    offset += b.byteLength / 32;
    buffers.push(new Uint8Array(b));
  }
  let bytes = new Uint8Array(offset * 32), at = 0;
  for (const b of buffers) {
    bytes.set(b, at);
    at += b.length;
  }
  descriptors = new Uint32Array(bytes.buffer);
  featureCard = new Uint16Array(offset);
  for (let c = 0; c < records.length; c++) {
    const r = records[c];
    featureCard.fill(c, r.offset, r.offset + r.count);
  }
  lookup = Array.from({ length: 4 }, (_, t) => {
    const offsets = new Uint32Array(65537);
    for (let i = 0; i < offset; i++) offsets[key(bytes, i * 32, t * 4) + 1]++;
    for (let i = 1; i < offsets.length; i++) offsets[i] += offsets[i - 1];
    const cursor = offsets.slice(), items = new Uint32Array(offset);
    for (let i = 0; i < offset; i++) items[cursor[key(bytes, i * 32, t * 4)]++] = i;
    return { offsets, items };
  });
  return records.length;
}
function geometry(matches) {
  const empty = { inliers: 0, art: 0, coverage: 0 };
  if (matches.length < 4) return empty;
  let mask = new jsfeat.matrix_t(matches.length, 1, jsfeat.U8_t | jsfeat.C1_t), m = new jsfeat.matrix_t(3, 3, jsfeat.F32_t | jsfeat.C1_t);
  const a = matches.map((v) => v.a), b = matches.map((v) => v.b);
  let seed = 2166136261;
  for (const v of matches) {
    seed = Math.imul(seed ^ Math.round(v.a.x * 13 + v.a.y * 7 + v.b.x * 5 + v.b.y * 3), 16777619) >>> 0;
  }
  const random = Math.random;
  let ok = false, bestCount = 0, bestMask = null;
  try {
    Math.random = () => {
      seed = Math.imul(seed, 1664525) + 1013904223 >>> 0;
      return seed / 4294967296;
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const found = jsfeat.motion_estimator.ransac(new jsfeat.ransac_params_t(4, 4, 0.5, 0.99), new jsfeat.motion_model.homography2d(), a, b, matches.length, m, mask, 180);
      if (found) {
        let n = 0;
        for (let j = 0; j < matches.length; j++) n += Boolean(mask.data[j]);
        if (n > bestCount) {
          bestCount = n;
          bestMask = mask.data.slice(0, matches.length);
          ok = true;
        }
        if (n >= matches.length * 0.65) break;
      }
    }
  } finally {
    Math.random = random;
  }
  if (!ok) return empty;
  mask.data.set(bestMask);
  let inliers = 0, art = 0, cells = /* @__PURE__ */ new Set();
  const illustrated = (p) => p.x > 25 && p.x < 231 && p.y > 65 && p.y < 218;
  for (let i = 0; i < matches.length; i++) if (mask.data[i]) {
    inliers++;
    const p = a[i];
    if (illustrated(p) && illustrated(b[i])) art++;
    cells.add(Math.min(2, Math.floor(p.x / 256 * 3)) + 3 * Math.min(3, Math.floor(p.y / 360 * 4)));
  }
  return { inliers, art, coverage: cells.size };
}
function match(rgba, neural = []) {
  const f = V.features(rgba, 256, 360, 260), q32 = new Uint32Array(f.desc.buffer), votes = new Float32Array(records.length), qbytes = f.desc;
  for (let q = 0; q < f.xy.length / 2; q++) {
    let hit = /* @__PURE__ */ new Map();
    for (let t = 0; t < 4; t++) {
      const k = key(qbytes, q * 32, t * 4);
      for (let flip = -1; flip < 16; flip++) {
        const bucket = flip < 0 ? k : k ^ 1 << flip, table = lookup[t];
        for (let at = table.offsets[bucket]; at < table.offsets[bucket + 1]; at++) {
          const i = table.items[at];
          let c = featureCard[i];
          let dist = V.distance(q32, q * 8, descriptors, i * 8);
          if (dist < 68 && dist < (hit.get(c) ?? 999)) hit.set(c, dist);
        }
      }
    }
    for (let [c, d] of hit) votes[c] += (68 - d) / 40;
  }
  let top = Array.from(votes, (score, i) => ({ i, score })).sort((a, b) => b.score - a.score).slice(0, 36), seen = new Set(top.map((r) => r.i)), byId = new Map(records.map((r, i) => [r.id, i]));
  for (const n of neural.slice(0, 20)) {
    const i = byId.get(n.id);
    if (i !== void 0 && !seen.has(i)) {
      top.push({ i, score: 0 });
      seen.add(i);
    }
  }
  let results = [];
  for (const candidate of top) {
    let r = records[candidate.i], matches = [], used = /* @__PURE__ */ new Set();
    for (let q = 0; q < f.xy.length / 2; q++) {
      let b = 257, s = 257, idx = -1;
      for (let p = 0; p < r.count; p++) {
        let d = V.distance(q32, q * 8, descriptors, (r.offset + p) * 8);
        if (d < b) {
          s = b;
          b = d;
          idx = p;
        } else if (d < s) s = d;
      }
      if (b < 65 && b < s * 0.86 && !used.has(idx)) {
        used.add(idx);
        matches.push({ a: { x: r.xy[idx * 2], y: r.xy[idx * 2 + 1] }, b: { x: f.xy[q * 2], y: f.xy[q * 2 + 1] }, d: b });
      }
    }
    let g = geometry(matches), score = g.inliers * 1.5 + g.art * 5 + g.coverage * 2;
    results.push({ id: r.id, score, ...g, matches: matches.length });
  }
  return { results: CardScanFusion.fuse(results, neural).slice(0, 24), features: f.xy.length / 2 };
}
self.onmessage = async (e) => {
  try {
    if (e.data.type === "init") postMessage({ type: "ready", count: await init(e.data.scope) });
    if (e.data.type === "match") {
      const start = performance.now();
      postMessage({ type: "results", ...match(e.data.rgba, e.data.neural), ms: Math.round(performance.now() - start), neuralUsed: Boolean(e.data.neural?.length), token: e.data.token });
    }
  } catch (e2) {
    postMessage({ type: "error", message: e2.message, token: e2.data.token });
  }
};
