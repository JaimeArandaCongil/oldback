var window = self;
importScripts("./jsfeat.js", "./regions.js");
self.onmessage = ({ data: d }) => {
  try {
    const result = CardRegions.detect(d.rgba, d.w, d.h);
    self.postMessage({ id: d.id, ...result });
  } catch {
    self.postMessage({ id: d.id, error: "No se pudieron localizar los bordes. Puedes marcar las cartas manualmente." });
  }
};
