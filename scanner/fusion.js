(function(root) {
  function fuse(results, neural = []) {
    const similarities = new Map(neural.map((r) => [r.id, r.similarity]));
    return results.map((r) => {
      const similarity = similarities.get(r.id) ?? 0;
      const neuralEligible = similarity >= 0.57 || similarity >= 0.3 && r.inliers >= 6 && r.art >= 3;
      const bonus = neuralEligible ? Math.max(0, Math.min(32, (similarity - 0.25) * 60)) : 0;
      const score = neuralEligible ? Math.max(r.score >= 100 ? r.score : r.score + bonus, similarity * 100) : r.score;
      return { ...r, orbScore: r.score, similarity, neuralEligible, score };
    }).sort((a, b) => b.score - a.score);
  }
  root.CardScanFusion = { fuse };
})(globalThis);
