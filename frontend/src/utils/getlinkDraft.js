export const GETLINK_PREVIEW_DRAFT_TTL_MS = 30_000;

export function restoreGetlinkDraft(stored, { initialUrl = "", resolveMode, now = Date.now() } = {}) {
  const draft = stored && typeof stored === "object" ? stored : {};
  const url = String(initialUrl || draft.url || "");
  const age = now - Number(draft.previewCheckedAt || 0);
  const reusable = draft.resolveMode === resolveMode && draft.previewUrl === url.trim()
    && draft.url === url && Number(draft.previewCheckedAt) > 0 && age >= 0 && age < GETLINK_PREVIEW_DRAFT_TTL_MS;
  return {
    url, includePreviewImage: Boolean(draft.includePreviewImage),
    preview: reusable && draft.preview && typeof draft.preview === "object" ? draft.preview : null,
    // Preserve metadata/status for display, but never restore hybrid checkout authority.
    requiresPreparation: Boolean(reusable && resolveMode === "hybrid"),
    previewUrl: reusable ? draft.previewUrl : "",
    selectedFormatKey: reusable ? String(draft.selectedFormatKey || "") : "",
    previewCheckedAt: reusable ? draft.previewCheckedAt : 0,
  };
}

export function getlinkRequestIdentity(payload) {
  const format = payload.downloadFormat;
  return JSON.stringify([payload.modelId, Boolean(payload.includePreviewImage),
    format ? [format.key, format.fileFormat, format.formatVersion, format.rendererType] : null]);
}

export function getlinkRequestId(storage, key, payload, createId) {
  const identity = getlinkRequestIdentity(payload);
  try {
    const saved = JSON.parse(storage.getItem(key) || "null");
    if (saved?.identity === identity && typeof saved.id === "string" && /^[\w-]{8,96}$/.test(saved.id)) return saved.id;
  } catch { /* Ignore legacy unbound IDs and malformed drafts. */ }
  const id = createId();
  try { storage.setItem(key, JSON.stringify({ identity, id })); } catch { /* Storage may be disabled. */ }
  return id;
}
