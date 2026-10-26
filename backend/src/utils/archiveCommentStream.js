import crypto from "node:crypto";
import { Readable } from "node:stream";
import { openStorageStream } from "./storageProvider.js";
import { DOWNLOAD_STREAM_BUFFER_BYTES, normalizeDownloadRange } from "./downloadTransfer.js";
import { archiveFormatError, rar5CommentPatch, RAR_PREFIX_BYTES, zipCommentPatch, ZIP_TAIL_BYTES } from "./archiveCommentFormat.js";

function changed() {
  return Object.assign(new Error("The source archive changed. Create a new download session."), { status: 409, code: "ARCHIVE_SOURCE_CHANGED" });
}

function validator(file) {
  return file.etag && !file.etag.startsWith("W/") ? file.etag : file.lastModified || "";
}

async function openRange(session, start, end, options) {
  const file = await (options.open || openStorageStream)(session, {
    range: `bytes=${start}-${end}`, ifRange: options.validator || "", signal: options.signal,
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
    return { bytes: Buffer.concat(chunks, length), validator: validator(file), lastModified: file.lastModified || "" };
  } finally { file.stream.destroy(); }
}

export async function prepareArchiveComment(session, comment, options = {}) {
  const total = Number(session.fileSize);
  if (!Number.isSafeInteger(total) || total < 22) throw archiveFormatError("The archive size is missing or invalid.");
  const bytes = Buffer.from(comment, "utf8");
  if (bytes.length > 8192) throw archiveFormatError("Archive comment is too long.");
  const format = String(session.archiveFormat || "").toLowerCase();
  let sample;
  let patch;
  if (format === "zip") {
    sample = await inspectBytes(session, Math.max(0, total - ZIP_TAIL_BYTES), total - 1, options);
    patch = zipCommentPatch(sample.bytes, total, bytes);
  } else if (format === "rar") {
    sample = await inspectBytes(session, 0, Math.min(total, RAR_PREFIX_BYTES) - 1, options);
    patch = rar5CommentPatch(sample.bytes, total, bytes);
  } else throw archiveFormatError("Archive comments currently support ZIP and plain single-volume RAR5 on web downloads only.");
  if (!sample.validator) throw archiveFormatError("Storage must supply a stable ETag or Last-Modified validator for marked downloads.");
  const size = total - (patch.end - patch.start) + patch.bytes.length;
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
    total, validator: sample.validator, start: patch.start, end: patch.end,
  })).update(sample.bytes).update(patch.bytes).digest("hex");
  return { ...patch, size, fingerprint, validator: sample.validator, lastModified: sample.lastModified,
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
  add(0, plan.start, 0);
  add(plan.start, plan.bytes.length, 0, plan.bytes);
  add(plan.start + plan.bytes.length, session.fileSize - plan.end, plan.end);
  const upstreamOptions = { ...options, validator: plan.validator };
  let current = null;
  if (blocks[0] && !blocks[0].bytes) current = await openRange(session, blocks[0].start, blocks[0].end, upstreamOptions);
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
