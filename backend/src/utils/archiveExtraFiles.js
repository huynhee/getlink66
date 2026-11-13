import crypto from "node:crypto";
import { archiveFormatError } from "./archiveCommentFormat.js";
import { archiveCommentText, validArchiveComment } from "./archiveTrace.js";

export const ARCHIVE_WEBSITE_SHORTCUT = "[InternetShortcut]\r\nURL=https://3dipl.org/\r\n";
export const MAX_ARCHIVE_EXTRAS_LENGTH = 20000;

export function validArchiveTextName(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9 _().-]{0,59}\.txt$/i.test(value)) return false;
  const base = value.slice(0, -4);
  return !base.includes("..") && !/[ .]$/.test(base)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base);
}

export function createArchiveExtraFiles(setting, token) {
  if (!setting?.archiveTextFileEnabled) return "";
  const filename = setting.archiveTextFileName ?? "3dipl.txt";
  const text = setting.archiveTextFileText ?? "3dipl.org";
  if (!validArchiveTextName(filename) || !validArchiveComment(text)) throw archiveFormatError("Invalid archive information file settings.");
  // The suffix is derived from the randomized trace, never from a visible user ID.
  const suffix = crypto.createHash("sha256").update(token).digest("hex").slice(0, 32);
  const base = `${filename.slice(0, -4)}-${suffix}`;
  return JSON.stringify([
    { name: `${base}.txt`, text: archiveCommentText(text, token) },
    { name: `${base}.url`, text: ARCHIVE_WEBSITE_SHORTCUT },
  ]);
}

export function readArchiveExtraFiles(value = "") {
  if (!value) return [];
  try {
    if (typeof value !== "string" || value.length > MAX_ARCHIVE_EXTRAS_LENGTH) throw new Error();
    const files = JSON.parse(value);
    if (!Array.isArray(files) || files.length !== 2) throw new Error();
    const [text, url] = files;
    for (const file of files) {
      if (!file || Object.keys(file).sort().join(",") !== "name,text" || typeof file.name !== "string"
        || typeof file.text !== "string" || Buffer.byteLength(file.text, "utf8") > 8192) throw new Error();
    }
    const match = /^(.+)-([a-f0-9]{32})\.txt$/.exec(text.name);
    if (!match || !validArchiveTextName(`${match[1]}.txt`)
      || url.name !== text.name.slice(0, -4) + ".url" || url.text !== ARCHIVE_WEBSITE_SHORTCUT
      || Array.from(text.text).some((character) => {
        const code = character.codePointAt(0);
        return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
      })) throw new Error();
    return files;
  } catch {
    throw archiveFormatError("Invalid archive information file snapshot.");
  }
}
