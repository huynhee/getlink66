import crypto from "node:crypto";
import { RAR_PREFIX_BYTES } from "./archiveCommentFormat.js";

export const MAX_ARCHIVE_PLAN_LENGTH = 200000;
const MAX_PATCH_BYTES = RAR_PREFIX_BYTES + 8192 + 128;
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
    v: 1, source: identity(session, session.fileSize), comment: hash(comment),
    start: plan.start, end: plan.end, bytes: plan.bytes.toString("base64"), size: plan.size,
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
    if (checksum !== hash(JSON.stringify(data)) || data.v !== 1 || session.storageProvider !== "google_drive"
      || data.source !== identity(session, session.sourceFileSize) || data.comment !== hash(session.archiveComment)
      || !/^gdrive-v1:[a-f0-9]{64}$/.test(data.sourceValidator)
      || !/^[a-f0-9]{64}$/.test(data.fingerprint) || data.fingerprint !== session.archiveSourceFingerprint
      || ![data.start, data.end, data.size, session.sourceFileSize].every(Number.isSafeInteger)
      || data.start < 0 || data.end <= data.start || data.end > session.sourceFileSize
      || data.size !== session.fileSize || typeof data.bytes !== "string"
      || typeof data.lastModified !== "string" || (data.lastModified && new Date(data.lastModified).toUTCString() !== data.lastModified)) throw invalidPlan();
    const bytes = Buffer.from(data.bytes, "base64");
    if (!bytes.length || bytes.length > MAX_PATCH_BYTES || bytes.toString("base64") !== data.bytes
      || data.size !== session.sourceFileSize - (data.end - data.start) + bytes.length) throw invalidPlan();
    return { start: data.start, end: data.end, bytes, size: data.size, fingerprint: data.fingerprint,
      validator: data.sourceValidator, sourceValidator: data.sourceValidator, lastModified: data.lastModified,
      etag: `"ipl-${data.fingerprint}"` };
  } catch {
    throw invalidPlan();
  }
}
