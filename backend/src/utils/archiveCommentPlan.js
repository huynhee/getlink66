import crypto from "node:crypto";
import { RAR_PREFIX_BYTES } from "./archiveCommentFormat.js";

export const MAX_ARCHIVE_PLAN_LENGTH = 262144;
const MAX_PATCH_BYTES = RAR_PREFIX_BYTES + 32768 + 2048;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const identity = (session, size) => hash(JSON.stringify([
  session.storageProvider, session.driveFileId, session.storageKey || "", Number(size), session.archiveFormat,
]));

function invalidPlan() {
  return Object.assign(new Error("The archive download snapshot is invalid. Create a new download session."), {
    status: 409, code: "ARCHIVE_SOURCE_CHANGED",
  });
}

export function serializeArchiveCommentPlan(session, comment, plan) {
  // Only Drive's pinned version can validate a saved patch without another archive probe.
  if (!plan.sourceValidator || session.storageProvider !== "google_drive") return "";
  const data = {
    v: plan.patches ? 2 : 1, source: identity(session, session.fileSize), comment: hash(comment),
    ...(plan.patches ? { extraFiles: hash(session.archiveExtraFiles || ""),
      patches: plan.patches.map(({ start, end, bytes }) => ({ start, end, bytes: bytes.toString("base64") })) }
      : { start: plan.start, end: plan.end, bytes: plan.bytes.toString("base64") }), size: plan.size,
    fingerprint: plan.fingerprint, sourceValidator: plan.sourceValidator, lastModified: plan.lastModified,
  };
  const encoded = JSON.stringify({ ...data, checksum: hash(JSON.stringify(data)) });
  if (encoded.length > MAX_ARCHIVE_PLAN_LENGTH) throw invalidPlan();
  return encoded;
}

export function restoreArchiveCommentPlan(session) {
  if (!session.archiveCommentPlan) return null;
  try {
    if (typeof session.archiveCommentPlan !== "string" || session.archiveCommentPlan.length > MAX_ARCHIVE_PLAN_LENGTH) throw invalidPlan();
    const { checksum, ...data } = JSON.parse(session.archiveCommentPlan);
    if (checksum !== hash(JSON.stringify(data)) || ![1, 2].includes(data.v) || session.storageProvider !== "google_drive"
      || data.source !== identity(session, session.sourceFileSize) || data.comment !== hash(session.archiveComment)
      || !/^gdrive-v1:[a-f0-9]{64}$/.test(data.sourceValidator)
      || !/^[a-f0-9]{64}$/.test(data.fingerprint) || data.fingerprint !== session.archiveSourceFingerprint
      || ![data.size, session.sourceFileSize].every(Number.isSafeInteger) || session.sourceFileSize < 22
      || data.size !== session.fileSize
      || typeof data.lastModified !== "string" || (data.lastModified && new Date(data.lastModified).toUTCString() !== data.lastModified)) throw invalidPlan();
    if (data.v === 1 && session.archiveExtraFiles) throw invalidPlan();
    if (data.v === 2 && (data.extraFiles !== hash(session.archiveExtraFiles || "") || !Array.isArray(data.patches)
      || !data.patches.length || data.patches.length > 4)) throw invalidPlan();
    const encodedPatches = data.v === 2 ? data.patches : [data];
    let cursor = 0;
    let size = session.sourceFileSize;
    let patchBytes = 0;
    const patches = encodedPatches.map((patch) => {
      if (!patch || ![patch.start, patch.end].every(Number.isSafeInteger) || patch.start < cursor || patch.end < patch.start
        || patch.end > session.sourceFileSize || typeof patch.bytes !== "string"
        || (data.v === 1 && patch.end === patch.start)) throw invalidPlan();
      const bytes = Buffer.from(patch.bytes, "base64");
      patchBytes += bytes.length;
      if (!bytes.length || patchBytes > MAX_PATCH_BYTES || bytes.toString("base64") !== patch.bytes) throw invalidPlan();
      size += bytes.length - (patch.end - patch.start);
      cursor = patch.end;
      return { start: patch.start, end: patch.end, bytes };
    });
    if (!Number.isSafeInteger(size) || data.size !== size) throw invalidPlan();
    return { ...(data.v === 2 ? { patches } : patches[0]), size: data.size, fingerprint: data.fingerprint,
      validator: data.sourceValidator, sourceValidator: data.sourceValidator, lastModified: data.lastModified,
      etag: `"ipl-${data.fingerprint}"` };
  } catch {
    throw invalidPlan();
  }
}
