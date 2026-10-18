import crypto from "node:crypto";
import { Resolver } from "node:dns/promises";
import { simpleParser } from "mailparser";
import { convert } from "html-to-text";
import { dkimVerify } from "mailauth/lib/dkim/verify.js";
import { verifyTimoGmailArc } from "./timoGmailArc.js";

const fail = (code) => { throw Object.assign(new Error("Timo notification requires review"), { code }); };
const normalize = (value) => String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();

export function parseTimoBody(text, config) {
  const content = normalize(text);
  // This is the actual Vietnamese Spend Account template supplied by the account owner.
  const owner = content.match(/^(.+?) thân mến,/u)?.[1];
  if (normalize(owner).toUpperCase() !== normalize(config.accountName).toUpperCase()) fail("TIMO_OWNER_MISMATCH");
  const balances = [...content.matchAll(/Tài khoản Spend Account vừa (tăng|giảm) ([\d.]+) VND vào (\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})\./gu)];
  if (balances.length !== 1) fail("TIMO_TEMPLATE_UNSUPPORTED");
  const [, direction, rawAmount, day, month, year, hour, minute] = balances[0];
  if (!/^(?:[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+)$/.test(rawAmount)) fail("TIMO_AMOUNT_INVALID");
  const amount = Number(rawAmount.replaceAll(".", ""));
  if (!Number.isSafeInteger(amount) || amount <= 0) fail("TIMO_AMOUNT_INVALID");
  const iso = `${year}-${month}-${day}T${hour}:${minute}:00+07:00`;
  const occurredAt = new Date(iso);
  if (!Number.isFinite(occurredAt.getTime())) fail("TIMO_DATE_INVALID");
  const local = new Date(occurredAt.getTime() + 7 * 60 * 60 * 1000).toISOString();
  if (local.slice(0, 16) !== iso.slice(0, 16)) fail("TIMO_DATE_INVALID");
  const description = content.match(/Mô tả:\s*(.*?)\s*Cảm ơn Quý khách/u)?.[1];
  if (!description) fail("TIMO_TEMPLATE_UNSUPPORTED");
  const codes = [...description.toUpperCase().matchAll(/\b(?:NAP|PRO)[A-Z0-9]{6,24}\b/g)].map((match) => match[0]);
  if (direction === "giảm") return { ignored: true, reason: "TIMO_OUTGOING_TRANSFER" };
  if (codes.length !== 1) fail(codes.length ? "TIMO_AMBIGUOUS_PAYMENT_CODE" : "TIMO_PAYMENT_CODE_MISSING");
  return { amount, occurredAt, paymentCode: codes[0] };
}

export async function verifyTimoNotification(raw, config, { verify = dkimVerify, resolver: resolveTxt } = {}) {
  if (!Buffer.isBuffer(raw) || raw.length > 512 * 1024) fail("TIMO_EMAIL_TOO_LARGE");
  const parserOptions = { skipImageLinks: true, skipHtmlToText: true, skipTextToHtml: true, maxHtmlLengthToParse: 512 * 1024 };
  let message = await simpleParser(raw, parserOptions);
  for (const header of ["from", "to", "subject", "message-id", "mime-version", "content-type"]) {
    if (message.headerLines.filter((line) => line.key === header).length !== 1) fail("TIMO_AMBIGUOUS_HEADERS");
  }
  if (message.from?.value?.length !== 1 || message.from.value[0].address?.toLowerCase() !== config.sender) fail("TIMO_SENDER_MISMATCH");
  if (message.to?.value?.length !== 1 || message.to.value[0].address?.toLowerCase() !== config.mailbox) fail("TIMO_RECIPIENT_MISMATCH");
  if (message.headerLines.filter((line) => line.key === "content-transfer-encoding").length > 1) fail("TIMO_AMBIGUOUS_HEADERS");
  if (normalize(message.subject) !== "Thông báo thay đổi số dư tài khoản") fail("TIMO_TEMPLATE_UNSUPPORTED");
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  let dnsUnavailable = false;
  const resolve = async (domain, type) => {
    if (type !== "TXT" || !/^[a-z0-9_-]{1,63}\._domainkey\.(?:timo\.vn|google\.com)\.?$/i.test(domain)) fail("TIMO_DKIM_DOMAIN_INVALID");
    try { return await (resolveTxt ? resolveTxt(domain, type) : resolver.resolveTxt(domain)); }
    catch (error) {
      if (!["ENODATA", "ENOTFOUND"].includes(error.code)) dnsUnavailable = true;
      throw error;
    }
  };
  const result = await verify(raw, { resolver: resolve });
  const required = ["from", "to", "subject", "message-id", "mime-version", "content-type"];
  if (message.headerLines.some((line) => line.key === "content-transfer-encoding")) required.push("content-transfer-encoding");
  const signature = result.results?.find((item) => {
    const signed = String(item.signingHeaders?.keys || "").toLowerCase().split(/:\s*/);
    return item.signingDomain === config.signingDomain && item.status?.result === "pass"
      && ["rsa-sha256", "ed25519-sha256"].includes(item.algo) && !item.canonBodyLengthLimited
      && item.signatureTimeValid !== false
      && required.every((header) => signed.includes(header));
  });
  let authenticationMethod = "dkim";
  if (!signature) {
    const authenticated = await verifyTimoGmailArc(raw, result, config, resolve);
    if (!authenticated) {
      if (dnsUnavailable || result.results?.some((item) => item.status?.result === "temperror")) fail("TIMO_DKIM_DNS_UNAVAILABLE");
      fail("TIMO_DKIM_INVALID");
    }
    message = await simpleParser(authenticated, parserOptions);
    authenticationMethod = "gmail_arc";
  }
  if (message.attachments.length) fail("TIMO_TEMPLATE_UNSUPPORTED");
  if (!message.messageId || message.messageId.length > 512) fail("TIMO_MESSAGE_ID_INVALID");
  const text = message.html ? convert(message.html, {
    wordwrap: false, selectors: [{ selector: "img", format: "skip" }, { selector: "a", options: { ignoreHref: true } }],
  }) : message.text;
  if (!text) fail("TIMO_TEMPLATE_UNSUPPORTED");
  try {
    return { ...parseTimoBody(text, config), authenticationMethod,
      signedMessageIdHash: crypto.createHash("sha256").update(`${config.signingDomain}\0${message.messageId}`).digest("hex") };
  } catch (error) {
    error.timoAuthenticated = true;
    error.timoAuthenticationMethod = authenticationMethod;
    throw error;
  }
}
