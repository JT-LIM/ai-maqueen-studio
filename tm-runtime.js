// @teachablemachine/pose 0.8.3 dispose() omits the classification model.
// Dispose both parts of the loaded pose model explicitly.
function disposeLoadedModel(model) {
  if (!model) return;
  for (const part of new Set([model.model, model.posenetModel])) {
    if (part && typeof part.dispose === 'function') part.dispose();
  }
}
