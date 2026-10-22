(function(root) {
  function halfToFloat(h) {
    const sign = h & 32768 ? -1 : 1, exponent = h >> 10 & 31, fraction = h & 1023;
    return sign * (exponent === 0 ? fraction * 2 ** -24 : exponent === 31 ? fraction ? NaN : Infinity : (1 + fraction / 1024) * 2 ** (exponent - 15));
  }
  function decode(buffer) {
    const words = new Uint16Array(buffer), values = new Float32Array(words.length);
    for (let i = 0; i < words.length; i++) values[i] = halfToFloat(words[i]);
    return values;
  }
  function unit(v) {
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n);
    if (!(n > 1e-10)) return v.fill(0);
    for (let i = 0; i < v.length; i++) v[i] /= n;
    return v;
  }
  function tensor(rgba, input) {
    const size = input.width * input.height, output = new Float32Array(size * 3);
    if (rgba.length !== size * 4) throw Error("Invalid neural image size");
    for (let c = 0; c < 3; c++) for (let i = 0; i < size; i++) output[c * size + i] = (rgba[i * 4 + c] / 255 - input.mean[c]) / input.std[c];
    return output;
  }
  function project(raw, projection, dimensions) {
    const n = raw.length, normalized = unit(Float32Array.from(raw)), output = new Float32Array(dimensions);
    if (projection.length !== n * (dimensions + 1)) throw Error("Invalid projection");
    for (let d = 0; d < dimensions; d++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += (normalized[i] - projection[i]) * projection[n + d * n + i];
      output[d] = sum;
    }
    return unit(output);
  }
  function rank(query, vectors, records, scope = "all", limit = 20) {
    const n = query.length, best = /* @__PURE__ */ new Map();
    for (let i = 0; i < records.length; i++) {
      if (scope !== "all" && records[i].era !== scope) continue;
      let score = 0;
      for (let d = 0; d < n; d++) score += query[d] * vectors[i * n + d];
      if (score > (best.get(records[i].id) ?? -Infinity)) best.set(records[i].id, score);
    }
    return [...best].map(([id, similarity]) => ({ id, similarity })).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }
  root.CardNeuralMath = { halfToFloat, decode, unit, tensor, project, rank };
})(globalThis);
