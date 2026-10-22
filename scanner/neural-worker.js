importScripts("./neural-math.js");
let session, manifest, projection, vectors, records, initializing;
async function init() {
  if (initializing) return initializing;
  initializing = (async () => {
    const base = new URL("../neural/", self.location.href);
    async function get(file) {
      if (!/^[a-zA-Z0-9./_-]+$/.test(file) || file.includes("..")) throw Error("Invalid neural asset");
      const r = await fetch(new URL(file, base));
      if (!r.ok) throw Error("Neural download failed");
      return r;
    }
    manifest = await (await get("manifest.json")).json();
    if (manifest.schema !== 1 || manifest.rawDimensions !== 1280 || manifest.dimensions !== 256) throw Error("Unsupported neural index");
    const runtime = new URL(manifest.runtime + "/", base).href;
    importScripts(runtime + "ort.wasm.min.js");
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = runtime;
    const [model, p, v, index] = await Promise.all([get(manifest.model).then((r) => r.arrayBuffer()), get(manifest.projection).then((r) => r.arrayBuffer()), get(manifest.vectors).then((r) => r.arrayBuffer()), get(manifest.index).then((r) => r.json())]);
    projection = new Float32Array(p);
    vectors = CardNeuralMath.decode(v);
    records = index;
    if (records.length !== manifest.vectorCount || new Set(records.map((r) => r.id)).size !== manifest.count || vectors.length !== records.length * manifest.dimensions || projection.length !== manifest.rawDimensions * (manifest.dimensions + 1) || !projection.every(Number.isFinite) || !vectors.every(Number.isFinite)) throw Error("Incomplete neural index");
    session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    const warm = new ort.Tensor("float32", new Float32Array(3 * 224 * 224), [1, 3, 224, 224]);
    const result = await session.run({ [manifest.inputName]: warm });
    Object.values(result).forEach((t) => t.dispose());
    warm.dispose();
    return { count: manifest.count };
  })();
  return initializing;
}
self.onmessage = async (e) => {
  const d = e.data;
  try {
    if (d.type === "init") {
      postMessage({ type: "ready", ...await init() });
      return;
    }
    if (d.type !== "match") return;
    await init();
    const start = performance.now(), input = new ort.Tensor("float32", CardNeuralMath.tensor(d.rgba, manifest.input), [1, 3, 224, 224]);
    const output = await session.run({ [manifest.inputName]: input });
    try {
      const query = CardNeuralMath.project(output[manifest.outputName].data, projection, manifest.dimensions);
      postMessage({ type: "results", token: d.token, results: CardNeuralMath.rank(query, vectors, records, d.scope), ms: Math.round(performance.now() - start) });
    } finally {
      input.dispose();
      Object.values(output).forEach((t) => t.dispose());
    }
  } catch (error) {
    postMessage({ type: "error", token: d.token, message: error.message });
  }
};
