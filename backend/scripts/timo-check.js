import "dotenv/config";
import fs from "node:fs/promises";
import { assertTimoConfigured, timoConfigurationIssues } from "../src/config/timoConfig.js";
import { assertTimoMailbox, gmailApi } from "../src/utils/timoGmail.js";
import { verifyTimoNotification } from "../src/utils/timoNotification.js";

try {
  const issues = timoConfigurationIssues();
  if (issues.length) throw new Error(issues.join("\n"));
  const config = assertTimoConfigured();
  const fileIndex = process.argv.indexOf("--eml");
  async function inspect(raw) {
    try {
      const notice = await verifyTimoNotification(raw, config);
      return { bankEmailAuthentic: true, ignored: notice.ignored === true, hasPaymentCode: Boolean(notice.paymentCode) };
    } catch (error) {
      if (error.timoAuthenticated && error.code === "TIMO_PAYMENT_CODE_MISSING") {
        return { bankEmailAuthentic: true, hasPaymentCode: false, reason: "Personal transfer notice; not a website order" };
      }
      throw error;
    }
  }
  if (fileIndex !== -1) {
    const file = await fs.readFile(process.argv[fileIndex + 1]);
    console.log(JSON.stringify(await inspect(file), null, 2));
  } else {
    const profile = await assertTimoMailbox();
    const verifyLatest = process.argv.includes("--verify-latest");
    const result = await gmailApi("/messages", { q: `from:${config.sender} subject:"Thông báo thay đổi số dư tài khoản" ${verifyLatest ? "newer_than:30d" : `after:${Math.floor(Date.parse(config.startAt) / 1000)}`}`, maxResults: 1, includeSpamTrash: true });
    let inspection;
    if (verifyLatest) {
      if (!result.messages?.length) throw Object.assign(new Error("No recent original Timo notification found in the mailbox"), { code: "TIMO_NOTIFICATION_NOT_FOUND" });
      const message = await gmailApi(`/messages/${result.messages[0].id}`, { format: "raw" });
      if (!message.raw || message.raw.length > 700000) throw Object.assign(new Error("Timo notification is too large"), { code: "TIMO_EMAIL_TOO_LARGE" });
      inspection = await inspect(Buffer.from(message.raw, "base64url"));
    }
    console.log(JSON.stringify({ mailbox: profile.emailAddress, configuredBank: "Timo by BVBank", credentials: "ok", notificationsFound: Boolean(result.messages?.length), readOnly: true, ...inspection }, null, 2));
  }
  console.log("Read-only check complete. No database connection, payment approval, message change or balance update.");
} catch (error) {
  console.error(error.code || "TIMO_CONFIGURATION_ERROR", error.message);
  if (error.gmailReason) console.error(JSON.stringify({ googleHttp: error.gmailStatus || null, reason: error.gmailReason, hint: error.gmailHint }, null, 2));
  process.exitCode = 1;
}
