import crypto from "node:crypto";
import { Readable } from "node:stream";
import { getStorageSourceValidator, openStorageStream } from "./storageProvider.js";
import { DOWNLOAD_STREAM_BUFFER_BYTES, normalizeDownloadRange } from "./downloadTransfer.js";
import { archiveFormatError, rar5CommentPatch, RAR_PREFIX_BYTES, zipCommentPatch, ZIP_TAIL_BYTES } from "./archiveCommentFormat.js";
import { RAR4_MAGIC, rar4CommentPatch } from "./archiveCommentRar4.js";
import { readArchiveExtraFiles } from "./archiveExtraFiles.js";
import { rarExtraFilesPatch, RAR_END_INSPECTION_BYTES } from "./archiveExtraRar.js";
import { prepareZipExtraFiles } from "./archiveExtraZip.js";

function changed() {
  return Object.assign(new Error("The source archive changed. Create a new download session."), { status: 409, code: "ARCHIVE_SOURCE_CHANGED" });
}

function validator(file) {
  if (file.sourceValidator) return file.sourceValidator;
  return file.etag && !file.etag.startsWith("W/") ? file.etag : file.lastModified || "";
}

async function openRange(session, start, end, options) {
  const file = await (options.open || openStorageStream)(session, {
    range: `bytes=${start}-${end}`, ifRange: options.sourceValidator ? "" : options.validator || "",
    sourceValidator: options.sourceValidator || "", signal: options.signal,
  });
  if (file.statusCode !== 206 || file.contentLength !== end - start + 1
    || file.contentRange !== `bytes ${start}-${end}/${session.fileSize}`
    || (options.validator && validator(file) !== options.validator)) {
    file.stream.destroy();
    throw changed();
  }
  file.stream.on("error", () => {});
  return file;
}

async function inspectBytes(session, start, end, options) {
  const file = await openRange(session, start, end, options);
  const chunks = [];
  let length = 0;
  try {
    for await (const chunk of file.stream) {
      length += chunk.length;
      if (length > end - start + 1) throw changed();
      chunks.push(chunk);
    }
    if (length !== end - start + 1) throw changed();
    return { bytes: Buffer.concat(chunks, length), validator: validator(file),
      sourceValidator: file.sourceValidator || "", lastModified: file.lastModified || "" };
  } finally { file.stream.destroy(); }
}

export async function prepareArchiveComment(session, comment, options = {}) {
  const total = Number(session.fileSize);
  if (!Number.isSafeInteger(total) || total < 22) throw archiveFormatError("The archive size is missing or invalid.");
  const bytes = Buffer.from(comment, "utf8");
  if (bytes.length > 8192) throw archiveFormatError("Archive comment is too long.");
  const format = String(session.archiveFormat || "").toLowerCase();
  if (format !== "zip" && format !== "rar") throw archiveFormatError("Archive comments currently support ZIP and plain single-volume RAR4/RAR5 on web downloads only.");
  const start = format === "zip" ? Math.max(0, total - ZIP_TAIL_BYTES) : 0;
  const end = format === "zip" ? total - 1 : Math.min(total, RAR_PREFIX_BYTES) - 1;
  let sourceValidator = "";
  if (options.pinDriveVersion && session.storageProvider === "google_drive") {
    sourceValidator = await getStorageSourceValidator(session, { signal: options.signal });
  }
  let sample = await inspectBytes(session, start, end, sourceValidator
    ? { ...options, validator: sourceValidator, sourceValidator } : options);
  if (!sample.validator && session.storageProvider === "google_drive") {
    sourceValidator = await getStorageSourceValidator(session, { signal: options.signal });
    // Re-read after pinning the version; the first, unvalidated probe must not define the output.
    sample = await inspectBytes(session, start, end, { ...options, validator: sourceValidator, sourceValidator });
  }
  if (!sample.validator) throw archiveFormatError("Storage must supply a stable ETag or Last-Modified validator for marked downloads.");
  const files = readArchiveExtraFiles(session.archiveExtraFiles);
  const read = async (from, to) => {
    if (![from, to].every(Number.isSafeInteger) || from < 0 || to < from || to >= total || to - from + 1 > 2 * 1024 * 1024) {
      throw archiveFormatError("Archive metadata exceeds the safe inspection window.");
    }
    if (from >= start && to <= end) return sample.bytes.subarray(from - start, to - start + 1);
    return (await inspectBytes(session, from, to, { ...options, validator: sample.validator, sourceValidator: sample.sourceValidator })).bytes;
  };
  let patch;
  if (format === "zip") patch = files.length
    ? await prepareZipExtraFiles({ tail: sample.bytes, total, comment: bytes, files, read })
    : zipCommentPatch(sample.bytes, total, bytes);
  else if (sample.bytes.subarray(0, 7).equals(RAR4_MAGIC)) {
    const tail = await read(total - 7, total - 1);
    patch = rar4CommentPatch(sample.bytes, total, bytes, tail);
    if (files.length) patch = { patches: [patch, rarExtraFilesPatch("rar4", tail, total, files)], format: "rar4" };
  } else patch = rar5CommentPatch(sample.bytes, total, bytes);
  if (files.length && patch.format === "rar5") {
    const tail = await read(Math.max(0, total - RAR_END_INSPECTION_BYTES), total - 1);
    patch = { patches: [patch, rarExtraFilesPatch("rar5", tail, total, files)], format: "rar5" };
  }
  const patches = patch.patches || [patch];
  const size = patches.reduce((size, piece) => size - (piece.end - piece.start) + piece.bytes.length, total);
  if (!Number.isSafeInteger(size)) throw archiveFormatError("Marked archive size exceeds safe integer limits.");
  if (patch.patches) {
    const digest = crypto.createHash("sha256").update(JSON.stringify({ total, validator: sample.validator,
      patches: patches.map(({ start, end }) => ({ start, end })) })).update(sample.bytes);
    for (const piece of patches) digest.update(piece.bytes);
    const fingerprint = digest.digest("hex");
    return { ...patch, size, fingerprint, validator: sample.validator, sourceValidator: sample.sourceValidator,
      lastModified: sample.lastModified, etag: `"ipl-${fingerprint}"` };
  }
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
    total, validator: sample.validator, start: patch.start, end: patch.end,
  })).update(sample.bytes).update(patch.bytes).digest("hex");
  return { ...patch, size, fingerprint, validator: sample.validator, sourceValidator: sample.sourceValidator, lastModified: sample.lastModified,
    etag: `"ipl-${fingerprint}"` };
}

function outputRange(value, size) {
  const normalized = normalizeDownloadRange(value);
  if (!normalized) return { start: 0, end: size - 1, partial: false };
  const [, first, last] = /^bytes=(\d*)-(\d*)$/.exec(normalized);
  const start = first ? Number(first) : Math.max(0, size - Number(last));
  const end = first && last ? Math.min(Number(last), size - 1) : size - 1;
  if (start >= size || end < start) throw Object.assign(new Error("Requested byte range is not satisfiable."), {
    status: 416, code: "BYTE_RANGE_NOT_SATISFIABLE", contentRange: `bytes */${size}`,
  });
  return { start, end, partial: true };
}

export async function openCommentedArchive(session, plan, options = {}) {
  const range = outputRange(options.ifRange && options.ifRange !== plan.etag ? "" : options.range, plan.size);
  const blocks = [];
  const add = (from, length, sourceStart, bytes) => {
    const start = Math.max(from, range.start);
    const end = Math.min(from + length - 1, range.end);
    if (start > end) return;
    if (bytes) blocks.push({ bytes: bytes.subarray(start - from, end - from + 1) });
    else blocks.push({ start: sourceStart + start - from, end: sourceStart + end - from });
  };
  let sourceAt = 0;
  let outputAt = 0;
  for (const patch of plan.patches || [plan]) {
    const length = patch.start - sourceAt;
    add(outputAt, length, sourceAt);
    outputAt += length;
    add(outputAt, patch.bytes.length, 0, patch.bytes);
    outputAt += patch.bytes.length;
    sourceAt = patch.end;
  }
  add(outputAt, session.fileSize - sourceAt, sourceAt);
  const upstreamOptions = { ...options, validator: plan.validator, sourceValidator: plan.sourceValidator };
  let current = null;
  const firstSource = blocks.find((block) => !block.bytes);
  if (firstSource) current = await openRange(session, firstSource.start, firstSource.end, upstreamOptions);
  else if (plan.sourceValidator && await getStorageSourceValidator(session, { signal: options.signal }) !== plan.sourceValidator) throw changed();
  const stream = Readable.from((async function* () {
    try {
      for (const block of blocks) {
        options.signal?.throwIfAborted();
        if (block.bytes) { yield block.bytes; continue; }
        current ||= await openRange(session, block.start, block.end, upstreamOptions);
        let length = 0;
        try {
          if (current.stream.errored) throw current.stream.errored;
          for await (const chunk of current.stream) {
            length += chunk.length;
            if (length > block.end - block.start + 1) throw changed();
            yield chunk;
          }
          if (length !== block.end - block.start + 1) throw changed();
        } finally { current.stream.destroy(); current = null; }
      }
    } finally { current?.stream.destroy(); }
  })(), { highWaterMark: DOWNLOAD_STREAM_BUFFER_BYTES, objectMode: false });
  current?.stream.once("error", (error) => stream.destroy(error));
  stream.once("close", () => current?.stream.destroy());
  return { stream, fileName: session.fileName, contentLength: range.end - range.start + 1,
    contentRange: range.partial ? `bytes ${range.start}-${range.end}/${plan.size}` : "",
    statusCode: range.partial ? 206 : 200, acceptRanges: "bytes", etag: plan.etag, lastModified: plan.lastModified };
}
