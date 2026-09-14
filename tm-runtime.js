// @teachablemachine/* 0.8.3 load() returns inference-only models.
// Its image dispose() assumes a training-only truncatedModel exists;
// its pose dispose() omits the classification model. Dispose loaded parts explicitly.
function disposeLoadedModel(model) {
  if (!model) return;
  for (const part of new Set([model.model, model.posenetModel, model.truncatedModel])) {
    if (part && typeof part.dispose === 'function') part.dispose();
  }
}
