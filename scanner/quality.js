(function(scope) {
  "use strict";
  function metrics(rgba, w, h) {
    let luma = new Float32Array(w * h), sum = 0, sq = 0;
    for (let i = 0; i < w * h; i++) {
      let j = i * 4, v = rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114;
      luma[i] = v;
      sum += v;
      sq += v * v;
    }
    let mean = sum / (w * h), contrast = Math.sqrt(Math.max(0, sq / (w * h) - mean * mean)), lap = 0, lapSq = 0, n = 0, clipped = 0, artCount = 0;
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      let i = y * w + x, k = 4 * i, v = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - w] - luma[i + w];
      lap += v;
      lapSq += v * v;
      n++;
      if (x > w * 0.12 && x < w * 0.88 && y > h * 0.2 && y < h * 0.6) {
        artCount++;
        if (rgba[k] > 249 && rgba[k + 1] > 249 && rgba[k + 2] > 249) clipped++;
      }
    }
    let sharpness = lapSq / n - (lap / n) ** 2, glare = clipped / Math.max(1, artCount);
    return { mean, contrast, sharpness, glare };
  }
  function advice(m, quad, stable, motion, area) {
    if (m.mean < 48) return { code: "dark", text: "Falta luz. Busca una zona m\xE1s iluminada." };
    if (!quad) return { code: "frame", text: "Encaja la carta entera en el marco. Puedes fotografiar igualmente." };
    if (area < 0.28) return { code: "distance", text: "Acerca un poco la carta, dejando visibles las cuatro esquinas." };
    if (motion > 0.025) return { code: "motion", text: "Mant\xE9n el m\xF3vil quieto un momento." };
    if (m.glare > 0.28 && m.contrast > 35) return { code: "glare", text: "Posible reflejo. Prueba a inclinar un poco la carta." };
    if (m.sharpness < 22 && m.contrast > 18) return { code: "blur", text: "La imagen parece desenfocada. Espera a que enfoque." };
    return stable ? { code: "ready", text: "Bordes estables. Puedes fotografiar." } : { code: "steady", text: "Carta detectada. Mant\xE9n el encuadre un momento." };
  }
  scope.CardQuality = { metrics, advice };
})(typeof self !== "undefined" ? self : globalThis);
