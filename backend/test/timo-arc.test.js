import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { dkimSign } from "mailauth/lib/dkim/sign.js";
import { dkimVerify } from "mailauth/lib/dkim/verify.js";
import { sealMessage } from "mailauth/lib/arc/index.js";
import { timoConfiguration } from "../src/config/timoConfig.js";
import { verifyTimoNotification } from "../src/utils/timoNotification.js";

const config = timoConfiguration({ TIMO_ACCOUNT_NAME: "TEST MERCHANT", TIMO_GMAIL_ADDRESS: "timo-fixture@gmail.com" });
const signedHeaders = "from:to:subject:message-id:mime-version:dkim-signature:date";
const keyPair = (bits = 2048) => {
  const keys = crypto.generateKeyPairSync("rsa", { modulusLength: bits });
  return { privateKey: keys.privateKey.export({ format: "pem", type: "pkcs8" }),
    record: `v=DKIM1; k=rsa; p=${keys.publicKey.export({ format: "der", type: "spki" }).toString("base64")}` };
};
const bankKey = keyPair();
const rotatedBankKey = keyPair();
const googleKey = keyPair();
const forgedKey = keyPair();

async function resolver(domain, type) {
  assert.equal(type, "TXT");
  if (domain === "bank._domainkey.timo.vn") return [[rotatedBankKey.record]];
  if (domain === "fixture._domainkey.google.com") return [[googleKey.record]];
  throw Object.assign(new Error("No fixture DNS key"), { code: "ENODATA" });
}

async function fixture({ domain = "google.com", headerList = signedHeaders, auth = {}, limitedBank = false,
  mime = "multipart", attachment = false, signingKey = googleKey,
  bankHeaders = "from:to:subject:message-id:mime-version:content-type:date",
  bankTime = new Date(Date.now() - 60_000), googleTime = new Date(Date.now() - 30_000) } = {}) {
  const boundary = "fixture-signed-boundary";
  const html = "<p>TEST MERCHANT thân mến, Tài khoản Spend Account vừa tăng 10.000 VND vào 18/10/2026 04:06. "
    + "Số dư hiện tại: 999.999.999 VND. Mô tả: NAPEXAMPLE123456. Cảm ơn Quý khách đã sử dụng dịch vụ Timo!</p>";
  const body = mime === "multipart"
    ? `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${html}\r\n`
      + (attachment ? `--${boundary}\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="fixture.txt"\r\n\r\nfixture\r\n` : "")
      + `--${boundary}--\r\n`
    : `${html}\r\n`;
  const raw = `From: Timo Support <support@timo.vn>\r\nTo: ${config.mailbox}\r\nSubject: Thông báo thay đổi số dư tài khoản\r\n`
    + `Message-ID: <fixture-${crypto.randomUUID()}@timo.vn>\r\nDate: ${new Date().toUTCString()}\r\nMIME-Version: 1.0\r\n`
    + (mime === "multipart" ? `Content-Type: multipart/mixed; boundary="${boundary}"\r\n` : "Content-Type: text/html; charset=utf-8\r\n")
    + `\r\n${body}`;
  const bank = await dkimSign(raw, { signTime: bankTime, headerList: bankHeaders,
    signatureData: [{ signingDomain: "timo.vn", selector: "bank", privateKey: bankKey.privateKey,
      ...(limitedBank ? { maxBodyLength: 10 } : {}) }] });
  assert.equal(bank.errors.length, 0);
  const original = Buffer.from(bank.signatures + raw);
  const verified = await dkimVerify(original, { resolver: async () => [[bankKey.record]] });
  const prefix = verified.results[0].signature.slice(0, 8);
  const authResults = `${auth.mta || "mx.google.com"}; dkim=${auth.dkim || "pass"} header.i=@${auth.domain || "timo.vn"} `
    + `header.s=${auth.selector || "bank"} header.b=${auth.prefix || prefix}; `
    + `dmarc=${auth.dmarc || "pass"} header.from=${auth.from || "timo.vn"}`;
  const seal = { signingDomain: domain, selector: "fixture", privateKey: signingKey.privateKey,
    algorithm: "rsa-sha256", cv: "none", signTime: googleTime, headerList, authResults };
  const arcHeaders = await sealMessage(original, seal);
  return Buffer.concat([arcHeaders, original]);
}

test("verified Gmail ARC authenticates the original bank body when the bank DNS key changes", async () => {
  const raw = await fixture();
  const current = await dkimVerify(raw, { resolver });
  assert.equal(current.results[0].status.result, "fail");
  const notice = await verifyTimoNotification(raw, config, { resolver });
  assert.equal(notice.authenticationMethod, "gmail_arc");
  assert.equal(notice.amount, 10000);
  assert.equal(notice.paymentCode, "NAPEXAMPLE123456");
  assert.match(notice.signedMessageIdHash, /^[a-f0-9]{64}$/);
});

test("ARC rejects tampered amounts, signed identities and sealed authentication results", async () => {
  const raw = await fixture();
  for (const [from, to] of [["10.000", "50.000"], ["Timo Support", "Forged Support"],
    ["fixture-", "forged-"], ["dkim=pass", "dkim=fail"]]) {
    const changed = Buffer.from(raw.toString().replace(from, to));
    await assert.rejects(verifyTimoNotification(changed, config, { resolver }), { code: "TIMO_DKIM_INVALID" });
  }
});

test("a Google-looking ARC header signed with an attacker key is never trusted", async () => {
  await assert.rejects(verifyTimoNotification(await fixture({ signingKey: forgedKey }), config, { resolver }), { code: "TIMO_DKIM_INVALID" });
  await assert.rejects(verifyTimoNotification(await fixture({ domain: "attacker.test" }), config, { resolver }), { code: "TIMO_DKIM_INVALID" });
});

test("Google must endorse this bank signature and aligned DMARC, not just seal any message", async () => {
  for (const auth of [{ dkim: "fail" }, { domain: "attacker.test" }, { selector: "other" }, { prefix: "AAAAAAAA" },
    { dmarc: "fail" }, { from: "attacker.test" }, { mta: "untrusted.example.test" }]) {
    await assert.rejects(verifyTimoNotification(await fixture({ auth }), config, { resolver }), { code: "TIMO_DKIM_INVALID" });
  }
});

test("ARC must sign every consumed identity and the exact bank DKIM header", async () => {
  for (const omitted of ["to", "subject", "message-id", "mime-version", "dkim-signature"]) {
    const headerList = signedHeaders.split(":").filter((name) => name !== omitted).join(":");
    await assert.rejects(verifyTimoNotification(await fixture({ headerList }), config, { resolver }), { code: "TIMO_DKIM_INVALID" });
  }
});

test("unsigned outer MIME type, charset, encoding and disposition cannot alter ARC payment interpretation", async () => {
  const raw = await fixture();
  const expected = await verifyTimoNotification(raw, config, { resolver });
  for (const type of ["text/plain; charset=utf-7", "text/html; charset=iso-8859-1", "application/octet-stream"]) {
    const changed = Buffer.from(raw.toString().replace('Content-Type: multipart/mixed; boundary="fixture-signed-boundary"',
      `Content-Type: ${type}\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="forged.html"`));
    const notice = await verifyTimoNotification(changed, config, { resolver });
    assert.deepEqual(notice, expected);
  }
});

test("ARC rejects unsupported root bodies, signed attachments and partial bank signatures", async () => {
  await assert.rejects(verifyTimoNotification(await fixture({ mime: "html" }), config, { resolver }), { code: "TIMO_ARC_MIME_UNSUPPORTED" });
  await assert.rejects(verifyTimoNotification(await fixture({ attachment: true }), config, { resolver }), { code: "TIMO_TEMPLATE_UNSUPPORTED" });
  await assert.rejects(verifyTimoNotification(await fixture({ limitedBank: true }), config, { resolver }), { code: "TIMO_DKIM_INVALID" });
});

test("ARC rejects duplicate headers and forwarded multi-hop chains", async () => {
  const raw = await fixture();
  for (const header of ["Content-Type: text/plain", "Subject: forged", "Content-Transfer-Encoding: base64\r\nContent-Transfer-Encoding: 8bit"]) {
    await assert.rejects(verifyTimoNotification(Buffer.concat([Buffer.from(`${header}\r\n`), raw]), config, { resolver }), { code: "TIMO_AMBIGUOUS_HEADERS" });
  }
  const forwarded = await sealMessage(raw, { signingDomain: "google.com", selector: "fixture", privateKey: googleKey.privateKey,
    algorithm: "rsa-sha256", cv: "pass", signTime: new Date(), headerList: signedHeaders,
    authResults: "mx.google.com; dkim=pass header.i=@timo.vn; dmarc=pass header.from=timo.vn" });
  await assert.rejects(verifyTimoNotification(Buffer.concat([forwarded, raw]), config, { resolver }), { code: "TIMO_DKIM_INVALID" });
});

test("ARC DNS failure stays retryable and never downgrades to trusting headers", async () => {
  const raw = await fixture();
  const unavailable = async (domain, type) => {
    if (domain.endsWith("._domainkey.google.com")) throw Object.assign(new Error("Fixture DNS timeout"), { code: "ETIMEOUT" });
    return resolver(domain, type);
  };
  await assert.rejects(verifyTimoNotification(raw, config, { resolver: unavailable }), { code: "TIMO_DKIM_DNS_UNAVAILABLE" });
});

test("bank identity headers must also be covered by the signature Google endorses", async () => {
  for (const omitted of ["to", "message-id", "content-type"]) {
    const bankHeaders = "from:to:subject:message-id:mime-version:content-type:date".split(":").filter((name) => name !== omitted).join(":");
    await assert.rejects(verifyTimoNotification(await fixture({ bankHeaders }), config, { resolver }), { code: "TIMO_DKIM_INVALID" });
  }
});

test("weak Google keys and future-dated bank signatures are rejected", async () => {
  const weak = keyPair(1024);
  const weakResolver = (domain, type) => domain === "fixture._domainkey.google.com" ? [[weak.record]] : resolver(domain, type);
  await assert.rejects(verifyTimoNotification(await fixture({ signingKey: weak }), config, { resolver: weakResolver }), { code: "TIMO_DKIM_INVALID" });
  await assert.rejects(verifyTimoNotification(await fixture({ bankTime: new Date(Date.now() + 3600_000) }), config, { resolver }), { code: "TIMO_DKIM_INVALID" });
});

test("direct DKIM cannot authorize an unsigned outer transfer encoding", async () => {
  const sealed = await fixture();
  const offset = sealed.indexOf("\r\nDKIM-Signature:");
  assert.ok(offset > 0);
  const original = sealed.subarray(offset + 2);
  const currentBankResolver = async () => [[bankKey.record]];
  const legitimate = await verifyTimoNotification(original, config, { resolver: currentBankResolver });
  assert.equal(legitimate.authenticationMethod, "dkim");
  const tampered = Buffer.from(original.toString().replace("MIME-Version: 1.0\r\n", "MIME-Version: 1.0\r\nContent-Transfer-Encoding: base64\r\n"));
  assert.equal((await dkimVerify(tampered, { resolver: currentBankResolver })).results[0].status.result, "pass");
  await assert.rejects(verifyTimoNotification(tampered, config, { resolver: currentBankResolver }), { code: "TIMO_DKIM_INVALID" });
});
