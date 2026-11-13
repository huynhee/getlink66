import fs from "node:fs";
import path from "node:path";

const dump = JSON.parse(fs.readFileSync(".cache/getlink-history-2026-10-04-to-10/history-links-recovered.json", "utf8"));
const lookup = new Map(dump.matches.map(row => [row.productId, row]));
const dateFormat = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Saigon", dateStyle: "short", timeStyle: "medium" });
const dayFor = value => new Date(new Date(value).getTime() + 7 * 3600000).toISOString().slice(0, 10);
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const csvCell = value => {
  let text = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};

const rows = dump.history.map(row => {
  const cache = lookup.get(row.productId);
  const clean = String(cache?.resolvedSourceUrl || "");
  const cleanSof = clean ? (new URL(clean).searchParams.get("sof") || "") : "";
  const cleanDigits = cleanSof.match(/^[A-Z]{3}(\d+)$/i)?.[1] || "";
  return {
    day: dayFor(row.createdAt),
    localTime: dateFormat.format(new Date(row.createdAt)),
    productId: row.productId,
    title: row.title,
    creditUsed: row.creditUsed,
    createdAt: row.createdAt,
    sourceUrl: String(cache?.sourceUrl || ""),
    resolvedSourceUrl: clean,
    cleanHasSign: Boolean(clean && new URL(clean).searchParams.get("sign")),
    cleanSof,
    cleanAccountMatches: Boolean(cleanDigits.startsWith("89635771") && cleanDigits.length >= 13),
    cacheUpdatedAt: cache?.cacheUpdatedAt || null,
    cacheLocalTime: cache?.cacheUpdatedAt ? dateFormat.format(new Date(cache.cacheUpdatedAt)) : "",
    urlProvenance: "productcache dump saved 2026-11-01; not a per-download URL audit",
  };
});

for (const row of rows) {
  if (dayFor(row.createdAt) < "2026-10-04" || dayFor(row.createdAt) > "2026-10-10") throw new Error("Unexpected history day");
  for (const value of [row.sourceUrl, row.resolvedSourceUrl].filter(Boolean)) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !["3d.3d66.com", "www.3d66.com", "3d66.com"].includes(url.hostname)) throw new Error("Unexpected URL destination");
    if ([...url.searchParams.keys()].some(key => /token|cookie|password|authorization|secret/i.test(key))) throw new Error("Unexpected authentication field");
  }
}

function renderLink(value, signed = null) {
  if (!value) return '<span class="missing">Không tìm thấy trong bản dump này</span>';
  const sof = new URL(value).searchParams.get("sof") || "";
  const digits = sof.match(/^[A-Z]{3}(\d+)$/i)?.[1] || "";
  const accountMismatch = signed !== null && !(digits.startsWith("89635771") && digits.length >= 13);
  const warning = (accountMismatch ? `<strong class="warning">Không mang ID 89635771 · sof: ${escape(sof)}</strong>` : "")
    + (signed === false ? '<strong class="warning">Không có sign trong link đã lưu</strong>' : "");
  return `${warning}<a href="${escape(value)}" target="_blank" rel="noopener noreferrer">Mở link</a><details><summary>Xem URL đầy đủ</summary><code>${escape(value)}</code></details>`;
}

function writeReport(selectedRows, rootName, fileStem, title, defaultDay = "") {
  const root = path.resolve(rootName);
  fs.mkdirSync(root, { recursive: true });
  const total = selectedRows.reduce((sum, row) => sum + Number(row.creditUsed || 0), 0);
  const found = selectedRows.filter(row => row.sourceUrl && row.resolvedSourceUrl).length;
  const metadata = {
    range: fileStem, timezone: "Asia/Saigon", recordCount: selectedRows.length, totalCredit: total,
    expectedAccountMarker: "89635771",
    savedCleanUrlsWithWrongAccount: selectedRows.filter(row => row.resolvedSourceUrl && !row.cleanAccountMatches).length,
    urlProvenance: "Only URL fields recovered from the original 2026-11-01 productcache dump. These are not proven original URLs of each October download. No production restoration or 3D66 visit was performed.",
    dumpFileName: "getlink-cache-20261101-203803.archive.gz",
    dumpSha256: "ce3c3281e3dd85e370954a74ed0cb77a0eb1d13adb08d76b4d796e76588e4e72",
    rows: selectedRows,
  };
  const csv = [["Ngay", "Gio Viet Nam", "Ma model", "Ten model", "Credit", "Link dau vao trong cache", "Link clear trong cache", "Clear co sign", "Cache cap nhat luc", "Nguon link"],
    ...selectedRows.map(row => [row.day, row.localTime, row.productId, row.title, row.creditUsed, row.sourceUrl, row.resolvedSourceUrl, row.cleanHasSign ? "yes" : "no", row.cacheLocalTime, row.urlProvenance])]
    .map(row => row.map(csvCell).join(",")).join("\r\n");
  fs.writeFileSync(path.join(root, `${fileStem}.csv`), "\uFEFF" + csv);
  fs.writeFileSync(path.join(root, `${fileStem}.json`), JSON.stringify(metadata, null, 2));
  const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>
  *{box-sizing:border-box}body{font:15px/1.6 system-ui,sans-serif;color:#17221e;background:#f5f7f6;margin:0;padding:28px}main{max-width:1600px;margin:auto}h1{font-size:26px;margin:0}p{margin:10px 0}nav{display:flex;gap:24px;flex-wrap:wrap;margin:18px 0}a{color:#006f4b}.notice{padding:14px 0;border-block:1px solid #cbd5d0;margin:18px 0}.notice strong{color:#725008}.stats{display:flex;gap:24px;flex-wrap:wrap;margin:16px 0}label{display:flex;gap:12px;align-items:center;flex-wrap:wrap}select{font:inherit;padding:7px 12px;border:1px solid #a5b7ac;background:white}.wrap{overflow-x:auto;margin-top:18px}table{border-collapse:collapse;table-layout:fixed;width:100%;min-width:900px;background:white}th,td{border-bottom:1px solid #d6dfda;text-align:left;padding:12px;vertical-align:top}th{background:#e7eee9;font-size:13px}th:first-child{width:190px}th:nth-child(2){width:25%}td .id{display:block;font:12px/1.7 ui-monospace,monospace;overflow-wrap:anywhere;margin-top:6px}small{display:block;color:#56665d;font-size:12px;margin-top:6px}summary{cursor:pointer;color:#006f4b;margin-top:8px}code{display:block;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all;font:12px/1.7 ui-monospace,monospace;margin-top:8px}.missing,.warning{display:block;color:#8a4918;font-size:13px;margin-bottom:8px}footer{font-size:13px;color:#56665d;margin-top:20px}[hidden]{display:none}@media(max-width:650px){body{padding:16px}h1{font-size:22px}}
  </style><main><h1>${escape(title)}</h1><p>Giờ Việt Nam (UTC+7). Dữ liệu riêng để xem, không khôi phục lên web.</p><div class="notice"><strong>Nguồn link: dump cache Getlink ngày 01/11/2026, không phải file Core .age đã giải mã.</strong><p>Lượt tải, mã model và Credit lấy từ lịch sử hiện tại. Hai link được ghép theo đúng mã model từ bản cache cũ; cache có thể đã được cập nhật sau ngày tải, nên không khẳng định đó chính xác là URL user gửi ở từng lượt. Không tạo lại sign hoặc tự mở link 3D66.</p></div><nav><a href="${fileStem}.csv">CSV có hai link</a><a href="${fileStem}.json">JSON có nguồn và thời điểm cache</a></nav><div class="stats"><span><strong id="count">${selectedRows.length}</strong> lượt</span><span><strong id="credit">${total}</strong> Credit</span><span><strong id="found">${found}</strong> lượt có đủ hai link từ cache</span></div><label>Ngày<select id="day"><option value="">Tất cả</option>${Array.from({ length: 7 }, (_, i) => `2026-10-${String(i + 4).padStart(2, "0")}`).map(day => `<option value="${day}"${day === defaultDay ? " selected" : ""}>${day}</option>`).join("")}</select></label><div class="wrap"><table><thead><tr><th>Thời gian tải</th><th>Model</th><th>Link đầu vào đã lưu<br>(sourceUrl trong cache)</th><th>Link clear đã lưu<br>(resolvedSourceUrl trong cache)</th></tr></thead><tbody>${selectedRows.map(row => `<tr data-day="${row.day}" data-credit="${Number(row.creditUsed || 0)}" data-pair="${row.sourceUrl && row.resolvedSourceUrl ? "1" : "0"}"><td>${escape(row.localTime)}<small>${Number(row.creditUsed || 0)} Credit</small></td><td><strong>${escape(row.title || row.productId)}</strong><span class="id">${escape(row.productId)}</span><small>Cache cập nhật: ${escape(row.cacheLocalTime || "Không có")}</small></td><td>${renderLink(row.sourceUrl)}</td><td>${renderLink(row.resolvedSourceUrl, row.cleanHasSign)}</td></tr>`).join("")}</tbody></table></div><footer>Link có sign là dữ liệu đã lưu; chưa kiểm tra còn hiệu lực. Không có email, cookie, token đăng nhập hoặc link tải file trong báo cáo này.</footer></main><script>const day=document.getElementById("day");function filter(){let n=0,c=0,p=0;document.querySelectorAll("tbody tr").forEach(row=>{row.hidden=Boolean(day.value&&row.dataset.day!==day.value);if(!row.hidden){n++;c+=Number(row.dataset.credit);p+=Number(row.dataset.pair)}});document.getElementById("count").textContent=n;document.getElementById("credit").textContent=c;document.getElementById("found").textContent=p;}day.addEventListener("change",filter);filter();</script></html>`;
  fs.writeFileSync(path.join(root, "index.html"), html);
  return { rows: selectedRows.length, withBothLinks: found, signedClean: selectedRows.filter(row => row.cleanHasSign).length, root };
}

const week = writeReport(rows, ".cache/getlink-history-2026-10-04-to-10", "getlink-2026-10-04-to-10", "Lịch sử và link Getlink 04–10/10/2026", "2026-10-07");
const day = writeReport(rows.filter(row => row.day === "2026-10-07"), ".cache/getlink-history-2026-10-07", "getlink-2026-10-07", "Lịch sử và link Getlink 07/10/2026", "2026-10-07");
const october8 = rows.filter(row => row.day === "2026-10-08");
const audit = writeReport(october8, ".cache/getlink-history-2026-10-08", "getlink-2026-10-08", "Đối chiếu link Getlink 08/10/2026", "2026-10-08");
if (october8.filter(row => row.resolvedSourceUrl && !row.cleanAccountMatches).length !== 12) throw new Error("Unexpected October-8 wrong-account count");
if (day.rows !== 10 || day.withBothLinks !== 10 || day.signedClean !== 9) throw new Error("Unexpected 07/10 report");
console.log(JSON.stringify({ week, day, audit }));
