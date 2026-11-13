# Archive Download Comments and Encrypted References

## Scope

- New **web** Model/Scene download sessions can receive a custom comment and a randomized AES-256-GCM reference.
- Original Drive files, compressed file data, and marketplace metadata are never written or recompressed.
- Supported: ZIP (including single-volume ZIP64), plain single-volume RAR4, and plain single-volume RAR5 with ordinary/solid compression and optional quick-open records.
- RAR4 requires a CRC-valid 13-byte main header and plain 7-byte end record. Unicode comments use an uncompressed UTF-16LE CMT service block; an existing leading CMT is replaced, not duplicated. Old embedded main comments, archive-wide checksums, signatures and unknown layouts are rejected.
- SFX, split/multi-volume archives, RAR recovery records, locked RAR archives, encrypted RAR headers, oversized or malformed headers, and 7z are rejected **before creating/charging a new marked session**. No automatic unmarked fallback is allowed. Disabling tracing remains an explicit admin policy decision.
- Existing plugin clients verify the original archive SHA-256, so plugin downloads remain byte-for-byte original and are **not marked**. Adding tracing to those clients requires a negotiated integrity contract and a corresponding plugin update; never substitute a modified archive under the old checksum.
- Getlink downloads and plugin release installers are unchanged.
- An optional setting adds one UTF-8 TXT and one Windows Internet Shortcut (`.url`) at the root of supported web download archives. The TXT contains editable text and the same encrypted reference as the archive comment. The shortcut opens `https://3dipl.org/` only when the recipient opens it; nothing is executed automatically.

## Enable

1. Generate a dedicated key on the VPS with `openssl rand -hex 32`.
2. Put the output in `/etc/3dipl/production/backend.env` as `ARCHIVE_TRACE_SECRET=<64 hex characters>`.
3. Back up this secret securely outside Git, logs, screenshots, and the database. Losing or replacing it makes existing references unreadable. No signing/encryption secret is editable or returned by admin APIs.
4. Build the reviewed backend/frontend images, run production `env:check`, and recreate those containers. No migration or Drive rewrite is needed.
5. In **Admin > General > Download history**, expand **Archive comments, TXT + URL and download tracing**, edit the comment text, enable marking, and save. Disabled by default.
6. To include the two information files, enable **Add both TXT and URL files to the archive** in the same form, set the TXT filename/content, and save. This option is independently off by default and requires the marking switch above. Default TXT name/content: `3dipl.txt` / `3dipl.org`. The URL filename shares the TXT basename, and its destination cannot be changed to an arbitrary site or protocol.

The flag, text, and a reference are snapshotted when a session is created. A new session gets a new 96-bit random nonce. Requests with the same idempotency key, parallel range connections, HEAD, retries, and resume reuse the existing session reference. Editing/disabling settings only affects new sessions, not bytes already being resumed.

New comments place the opaque `ipl1....` token on its own line without a `Ref:` label. Existing sessions and archives keep their original bytes; admin lookup accepts either format.

Both added filenames receive a 32-hex-character suffix derived from the randomized reference. This avoids replacing source entries without disclosing a user ID. TXT basenames are limited to 64 ASCII characters, cannot be paths or Windows device names, and must end in `.txt`. TXT/comment text is limited to 4096 UTF-8 bytes without unsafe controls. The TXT reference can be pasted into the same admin lookup; it is not a second charge or a new reference. The URL contains only `[InternetShortcut]` and `URL=https://3dipl.org/`.

## Delivery and Resources

Comment-only preparation reads at most 65,557 trailing ZIP bytes or 128 KiB of RAR prefix. RAR4 additionally checks the final 7 bytes under the same source validator (reusing the prefix if the archive is small). It streams original compressed payload bytes around a small generated patch. There is no full-file buffering, archive extraction, temporary full-file copy, or recompression. The primary cost remains network bandwidth.

With TXT/URL enabled, ZIP preparation also reads the central directory (capped at 2 MiB) and bounded ZIP64 trailer metadata. The existing `yauzl` parser reads only these cached metadata windows, never the compressed payload or one network request per entry. Two stored entries are inserted before the directory; original central entries are streamed unchanged, followed by the two new central entries and rebuilt EOCD/ZIP64 trailers. Malformed, encrypted, signed, split, overlapping or ambiguous directory layouts and filename collisions fail closed. Large directories above the cap require disabling the optional TXT/URL policy for new sessions rather than unbounded inspection.

RAR4/RAR5 append two stored file blocks immediately before a CRC-valid plain single-volume end record, after all original compressed files. This leaves solid dictionaries untouched. The RAR5 end inspection is bounded to 32 bytes and currently accepts the ordinary 8-byte end record only; padded/extended/trailing layouts are rejected. Adding either file does not require downloading/extracting the original payload first. Metadata reads are pinned to the same source version as the stream. Full delivery normally uses two source ranges around the generated patches; resume reads only the required source spans.

The virtual representation has its own `Content-Length`, strong session-specific ETag, and byte-range mapping. A stale/weak/unknown If-Range causes a complete response. The source size, probe fingerprint, and upstream validator are pinned; a changed source is rejected instead of mixing old and new bytes. Storage must support exact byte-range responses. A transient source/open failure is never silently downgraded to an unmarked download or public Drive redirect.

New Drive sessions pin the read-only file metadata (`id`, `version`, `size`, and available MD5) before archive inspection, and confirm that version after opening each inspected range. They save the small generated patches and byte mapping privately in DownloadSession, not the original file, central directory or full probe. The bounded snapshot (normally a few KiB, maximum 262,144 JSON characters) is tied to the source, comment, information-file snapshot, transformed size and fingerprint, with an integrity checksum. It is not exposed in the session API. It survives backend restarts and expires with the existing session retention; no extra cache or migration is required. Comment-only snapshots retain version 1; the two-file variant uses version 2 with ordered source-coordinate patches. Both versions remain readable.

File/HEAD/Range requests reuse that snapshot rather than reading the archive prefix/tail again. Each source media stream is still held until a fresh metadata check confirms the pinned version. Generated-only ranges also check the version; ranges beginning in the patch preopen their first source stream before billing. The private fingerprint is never sent as an HTTP If-Range header. Missing version, changed size/version, invalid snapshots, or unavailable metadata fail closed before releasing that stream; no revisions are modified or retained on Drive.

Sessions created before saved patches retain the previous preflight path and fingerprints. If their Drive response lacks ETag/Last-Modified, the legacy path pins metadata and repeats the probe as before. Non-Drive storage keeps the existing HTTP validator checks.

RAR main-header locator records are removed and the header CRC is recomputed so quick-open locations are discovered sequentially. Existing CMT data is replaced; file headers/compressed payload and quick-open-relative file distances stay unchanged. RAR recovery-record archives are deliberately refused because modifying prefix bytes would invalidate recovery information.

The web session reports the transformed size and no original SHA-256 for transformed bytes. Current plugins continue to get the original size and SHA-256. Original download counting, billing idempotency, and 24-hour Credit entitlements are unchanged.

## Investigate a Reference

Paste the `ipl1....` reference or complete comment into the admin lookup form. Authenticated admin permission, allowlisted email, configured 2FA, CSRF, rate limits, and audit logging are required. Tokens are redacted in audit logs. The result identifies the user, asset, originating session and issue time even after the short-lived DownloadSession expires; retained download status is shown when available.

The marker is **not DRM**, cannot be made undeletable, and can be copied to another archive. Authentication proves the reference was generated by this server, not who subsequently distributed a file. Review the actual asset and other evidence before taking account action. The system never auto-bans a user.

## Verification / Rollback

- Run `npm run check`.
- Run `node --test backend/test/archive-comment.test.js backend/test/archive-comment-rar4.test.js backend/test/archive-comment-drive.test.js backend/test/archive-comment-http.test.js` for encryption, auth, format, Range, Drive responses without HTTP validators, source changes, quota/Credit, idempotency and plugin compatibility.
- Also run `node --test backend/test/archive-extra-files.test.js backend/test/archive-extra-settings.test.js backend/test/archive-extra-zip.test.js backend/test/archive-extra-rar.test.js` for safe TXT/URL snapshots, old admin-client compatibility, ZIP64 promotion, bounded directory inspection, source-file preservation and extraction of both added files.
- On Windows with WinRAR installed, format tests additionally validate RAR4/RAR5 fixtures with `Rar.exe t`, compare extracted file bytes, and verify Unicode comments. RAR4 also replaces a native WinRAR-written comment. They never run a downloaded executable or use customer archives.

- Run `node backend/scripts/qa-archive-comments.js frontend/dist <temporary-evidence-directory>` after `npm run build:release` for VI/EN, light/dark and desktop/mobile admin UI.
- Operational rollback: disable TXT/URL to return new sessions to comment-only delivery, or disable the master marking flag to return originals. Existing sessions retain their snapshotted bytes until expiry. Keep the encryption key and new server for at least the active-session TTL. Do not roll back to a server that cannot read version-2 snapshots while those sessions are active; restarting the older server can break resume or incorrectly transform their files. No Drive restoration is necessary.

RAR4 layout references: [UnRAR header parsing](https://github.com/pmachapman/unrar/blob/master/arcread.cpp), [Unicode archive comments](https://github.com/pmachapman/unrar/blob/master/arccmt.cpp). The RAR4 code is a bounded byte-splice writer, not an extractor.

Additional format references: [PKWARE APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT), [RAR5 technical note](https://www.rarlab.com/technote.htm), [yauzl](https://github.com/thejoshwolfe/yauzl). Native fixture tests use WinRAR when installed and never download or open customer files.
