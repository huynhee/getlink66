import { arc } from "mailauth/lib/arc/index.js";

const SIGNED_HEADERS = ["from", "to", "subject", "message-id", "mime-version", "dkim-signature"];
const trustedDomain = (value) => String(value || "").toLowerCase() === "google.com";
const failMime = () => { throw Object.assign(new Error("Timo notification requires review"), { code: "TIMO_ARC_MIME_UNSUPPORTED" }); };

function signedMultipartMessage(raw, headers) {
  const separator = raw.indexOf("\r\n\r\n");
  if (separator < 0 || separator > 64 * 1024) failMime();
  const body = raw.subarray(separator + 4);
  const firstLineEnd = body.indexOf("\r\n");
  if (firstLineEnd < 3 || firstLineEnd > 74) failMime();
  const firstLine = body.subarray(0, firstLineEnd).toString("latin1");
  if (!firstLine.startsWith("--")) failMime();
  const boundary = firstLine.slice(2);
  if (!/^[0-9A-Za-z'()+_,./:=?-]{1,70}$/.test(boundary)) failMime();
  const closing = Buffer.from(`\r\n--${boundary}--`);
  const closingAt = body.lastIndexOf(closing);
  if (closingAt < 0) failMime();
  const afterClosing = body.subarray(closingAt + closing.length);
  if (afterClosing.length && !afterClosing.subarray(0, 2).equals(Buffer.from("\r\n"))) failMime();

  // Gmail AMS does not sign the outer MIME headers. Parse only its signed
  // multipart body, deriving the boundary from that body, not an unsigned header.
  const signed = headers.filter((header) => SIGNED_HEADERS.includes(header.key));
  return Buffer.concat([
    ...signed.flatMap((header) => [header.line, Buffer.from("\r\n")]),
    Buffer.from(`Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`),
    body,
  ]);
}

export async function verifyTimoGmailArc(raw, verification, config, resolver) {
  const chain = verification.arc?.chain;
  const headers = verification.headers?.parsed || [];
  // Only a direct, single Gmail hop is supported. Forwarded/other sealers must
  // stay in review even if their ARC chain is cryptographically valid.
  if (chain?.length !== 1 || chain[0].i !== 1) return null;
  const entry = chain[0];
  if (!trustedDomain(entry["arc-seal"]?.parsed?.d?.value)
    || !trustedDomain(entry["arc-message-signature"]?.parsed?.d?.value)
    || entry["arc-seal"]?.parsed?.cv?.value !== "none") return null;
  for (const name of [...SIGNED_HEADERS, "arc-seal", "arc-message-signature", "arc-authentication-results"]) {
    if (headers.filter((header) => header.key === name).length !== 1) return null;
  }

  const proof = await arc(verification.arc, { resolver, minBitLength: 2048 });
  const signature = proof.signature;
  const signed = String(signature?.signingHeaders?.keys || "").toLowerCase().split(/:\s*/);
  if (proof.status?.result !== "pass" || proof.i !== 1 || !trustedDomain(signature?.signingDomain)
    || signature.status?.result !== "pass" || signature.algo !== "rsa-sha256"
    || !Number.isInteger(signature.modulusLength) || signature.modulusLength < 2048 || signature.signatureTimeValid !== true
    || signature.canonBodyLengthLimited !== false || !SIGNED_HEADERS.every((name) => signed.includes(name))) return null;

  const authentication = proof.authenticationResults;
  if (authentication?.mta !== "mx.google.com" || authentication.dmarc?.result !== "pass"
    || authentication.dmarc.header?.from?.toLowerCase() !== config.signingDomain) return null;
  const bank = verification.results?.filter((item) => item.signingDomain === config.signingDomain);
  const bankHeaders = String(bank?.[0]?.signingHeaders?.keys || "").toLowerCase().split(/:\s*/);
  if (bank?.length !== 1 || !["rsa-sha256", "ed25519-sha256"].includes(bank[0].algo)
    || bank[0].canonBodyLengthLimited !== false || bank[0].signatureTimeValid !== true
    || !bank[0].bodyHash || bank[0].bodyHash !== bank[0].bodyHashExpecting
    || !["from", "to", "subject", "message-id", "mime-version", "content-type"].every((name) => bankHeaders.includes(name))) return null;
  const endorsed = authentication.dkim?.filter((item) => {
    const prefix = item.header?.b;
    return item.result === "pass" && item.header?.i?.toLowerCase() === `@${config.signingDomain}`
      && item.header?.s === bank[0].selector && typeof prefix === "string" && prefix.length >= 8
      && prefix.length <= 64 && bank[0].signature?.startsWith(prefix);
  });
  if (endorsed?.length !== 1) return null;
  return signedMultipartMessage(raw, headers);
}
