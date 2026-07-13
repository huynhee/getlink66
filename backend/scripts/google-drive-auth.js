import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const DEFAULT_REDIRECT_URI = "http://127.0.0.1:53682/oauth2/callback";
const clientId = String(process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
const clientSecret = String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").trim();
const redirectUri = String(process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI || DEFAULT_REDIRECT_URI).trim();
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
const state = crypto.randomBytes(24).toString("hex");

function fail(message) {
  console.error(`\n[Drive OAuth] ${message}\n`);
  process.exitCode = 1;
}

function updateEnvValue(content, key, value) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) return content.replace(pattern, line);
  return `${content.replace(/\s*$/, "")}${newline}${line}${newline}`;
}

function saveRefreshToken(refreshToken) {
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  content = updateEnvValue(content, "GOOGLE_DRIVE_REFRESH_TOKEN", refreshToken);
  content = updateEnvValue(content, "GOOGLE_DRIVE_ACCESS_TOKEN", "");
  content = updateEnvValue(content, "GOOGLE_DRIVE_BEARER_TOKEN", "");
  fs.writeFileSync(envPath, content, { encoding: "utf8", mode: 0o600 });
}

function openBrowser(url) {
  const command = process.platform === "win32"
    ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  try {
    const child = spawn(command[0], command[1], { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // The authorization URL is also printed for environments without a desktop browser.
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlPage(title, body, success = false) {
  const color = success ? "#04936a" : "#b42318";
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><body style="margin:0;background:#f5f8fb;color:#122033;font-family:Arial,sans-serif"><main style="max-width:640px;margin:64px auto;padding:28px;background:#fff;border:1px solid #d6e0ea;border-top:4px solid ${color};border-radius:8px"><h1 style="margin-top:0;font-size:24px">${escapeHtml(title)}</h1><p style="line-height:1.6">${body}</p></main></body></html>`;
}

async function exchangeCode(code) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${payload.error || response.status}: ${payload.error_description || "Token exchange failed"}`);
  }
  if (!payload.refresh_token) {
    throw new Error("Google không trả refresh token. Hãy thu hồi quyền ứng dụng trong Google Account rồi chạy lại.");
  }
  return payload;
}

async function verifyDriveToken(accessToken) {
  const response = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(displayName),storageQuota(limit,usage)", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Drive API verification failed: HTTP ${response.status}`);
  return response.json();
}

if (!clientId || !clientSecret) {
  fail("Thiếu GOOGLE_DRIVE_CLIENT_ID/GOOGLE_DRIVE_CLIENT_SECRET (hoặc GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET) trong backend/.env.");
} else {
  let parsedRedirect;
  try {
    parsedRedirect = new URL(redirectUri);
  } catch {
    fail(`GOOGLE_DRIVE_OAUTH_REDIRECT_URI không hợp lệ: ${redirectUri}`);
  }

  if (parsedRedirect && !["127.0.0.1", "localhost"].includes(parsedRedirect.hostname)) {
    fail("Công cụ local chỉ nhận redirect URI trên 127.0.0.1 hoặc localhost.");
  } else if (parsedRedirect) {
    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: DRIVE_SCOPE,
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      state,
    }).toString();

    const server = http.createServer(async (req, res) => {
      const requestUrl = new URL(req.url || "/", redirectUri);
      if (requestUrl.pathname !== parsedRedirect.pathname) {
        res.writeHead(404).end("Not found");
        return;
      }
      if (requestUrl.searchParams.get("state") !== state) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(htmlPage("Xác thực thất bại", "OAuth state không khớp. Hãy đóng trang và chạy lại lệnh."));
        return;
      }
      const oauthError = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      if (oauthError || !code) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(htmlPage("Chưa cấp quyền Drive", `Google trả về: ${escapeHtml(oauthError || "missing_code")}.`));
        return;
      }

      try {
        const tokens = await exchangeCode(code);
        const drive = await verifyDriveToken(tokens.access_token);
        saveRefreshToken(tokens.refresh_token);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(htmlPage(
          "Đã kết nối Google Drive",
          `Tài khoản <strong>${escapeHtml(drive.user?.displayName || "Google Drive")}</strong> đã được cấu hình tự gia hạn token. Có thể đóng trang này và khởi động lại backend.`,
          true,
        ));
        console.log("\n[Drive OAuth] Thành công. Refresh token đã được lưu vào backend/.env.");
        console.log("[Drive OAuth] Access token tạm đã được xóa. Hãy khởi động lại backend.\n");
      } catch (error) {
        res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
        res.end(htmlPage("Không thể kết nối Drive", escapeHtml(error.message)));
        fail(error.message);
      } finally {
        setTimeout(() => server.close(), 250);
      }
    });

    server.listen(Number(parsedRedirect.port || 80), parsedRedirect.hostname, () => {
      console.log("\nGoogle Cloud Console phải có Authorized redirect URI chính xác:");
      console.log(`  ${redirectUri}\n`);
      console.log("Đang mở trình duyệt để cấp quyền Drive. Nếu trình duyệt không mở, truy cập URL sau:\n");
      console.log(authorizationUrl.toString());
      openBrowser(authorizationUrl.toString());
    });

    server.on("error", (error) => fail(`Không mở được OAuth callback server: ${error.message}`));
    setTimeout(() => {
      if (server.listening) {
        server.close();
        fail("Hết 10 phút chờ cấp quyền Google Drive.");
      }
    }, 10 * 60 * 1000).unref();
  }
}
