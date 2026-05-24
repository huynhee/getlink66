let originalHref = "";
let originalIconLinks = [];
let notificationCount = 0;
let progressActive = false;
let progressTimer = null;
let progressValue = 0;
let wavePhase = 0;

function rememberOriginalIcons() {
  if (originalIconLinks.length) return;
  originalIconLinks = Array.from(
    document.querySelectorAll("link[rel='icon'], link[rel='shortcut icon']"),
  )
    .filter((link) => link.dataset.dynamicFavicon !== "true")
    .map((link) => ({
      link,
      href: link.href || "",
      type: link.type || "",
      sizes: link.getAttribute("sizes") || "",
    }));
  const pngIcon =
    originalIconLinks.find((item) => /png/i.test(item.type) || /\.png(?:\?|$)/i.test(item.href)) ||
    originalIconLinks[0];
  if (!originalHref) originalHref = pngIcon?.href || "";
}

function faviconLink() {
  rememberOriginalIcons();
  let link = document.querySelector("link[data-dynamic-favicon='true']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    link.sizes = "32x32";
    link.dataset.dynamicFavicon = "true";
    if (originalHref) link.href = originalHref;
    document.head.appendChild(link);
  }
  if (!originalHref) originalHref = link.href || "";
  return link;
}

function faviconLinks() {
  const dynamic = faviconLink();
  return Array.from(
    document.querySelectorAll("link[rel='icon'], link[rel='shortcut icon']"),
  ).concat(dynamic);
}

function setFaviconHref(href) {
  if (!href) return;
  for (const link of new Set(faviconLinks())) {
    link.rel = "icon";
    link.type = "image/png";
    link.href = href;
  }
}

function restoreOriginalFavicon() {
  rememberOriginalIcons();
  for (const item of originalIconLinks) {
    item.link.href = item.href;
    item.link.type = item.type;
    if (item.sizes) item.link.setAttribute("sizes", item.sizes);
    else item.link.removeAttribute("sizes");
  }
  const dynamic = document.querySelector("link[data-dynamic-favicon='true']");
  if (dynamic && originalHref) dynamic.href = originalHref;
}

function stopProgressAnimation() {
  if (progressTimer) {
    window.clearInterval(progressTimer);
    progressTimer = null;
  }
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function drawProgress(value, phase = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return originalHref || "";
  const progress = Math.max(0, Math.min(100, Number(value || 0)));
  const fillHeight = Math.max(2, progress * 0.2);
  const waterTop = 26 - fillHeight;
  const waveAmp = progress > 3 && progress < 98 ? 1.6 : 0.6;
  const slosh = Math.sin(phase * 0.72) * 1.1;

  ctx.fillStyle = "#070908";
  ctx.fillRect(0, 0, 32, 32);

  ctx.save();
  ctx.beginPath();
  roundedRectPath(ctx, 6, 5, 20, 22, 4);
  ctx.clip();

  ctx.fillStyle = "rgba(0, 255, 136, 0.08)";
  ctx.fillRect(6, 5, 20, 22);

  ctx.beginPath();
  ctx.moveTo(6, 28);
  ctx.lineTo(6, waterTop + slosh);
  for (let x = 6; x <= 26; x += 1) {
    const y =
      waterTop +
      slosh +
      Math.sin((x - 6) * 0.72 + phase) * waveAmp +
      Math.sin((x - 6) * 0.28 + phase * 1.7) * 0.55;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(26, 28);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, waterTop, 0, 28);
  gradient.addColorStop(0, "#8dffd0");
  gradient.addColorStop(0.34, "#00ff88");
  gradient.addColorStop(1, "#00b86b");
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  for (let x = 6; x <= 26; x += 1) {
    const y = waterTop + slosh + Math.sin((x - 6) * 0.72 + phase) * waveAmp;
    if (x === 6) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(244,255,249,0.72)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();

  ctx.strokeStyle = "rgba(0,255,136,0.38)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  roundedRectPath(ctx, 5, 4, 22, 24, 4);
  ctx.stroke();

  ctx.strokeStyle = "rgba(0,255,136,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(2.5, 2.5, 27, 27);

  return canvas.toDataURL("image/png");
}

function drawBadge(count) {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return originalHref || "";
  const text = count > 99 ? "99+" : String(count);

  ctx.fillStyle = "#070908";
  ctx.fillRect(0, 0, 32, 32);
  ctx.strokeStyle = "rgba(0,255,136,0.32)";
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, 28, 28);

  ctx.fillStyle = "#00c853";
  ctx.beginPath();
  roundedRectPath(ctx, 14, 16, 17, 14, 4);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 22.5, 23);

  ctx.fillStyle = "#00ff88";
  ctx.font = "bold 9px monospace";
  ctx.fillText("3D", 12, 13);

  return canvas.toDataURL("image/png");
}

function applyNotificationBadge() {
  if (typeof document === "undefined" || progressActive) return;
  const count = Math.max(0, Number(notificationCount || 0));
  if (count > 0) setFaviconHref(drawBadge(count));
  else restoreOriginalFavicon();
}

export function setFaviconProgress(value) {
  if (typeof document === "undefined") return;
  try {
    const progress = Math.max(0, Math.min(100, Math.round(Number(value || 0))));
    progressActive = true;
    progressValue = progress;

    faviconLink();
    if (!progressTimer) {
      progressTimer = window.setInterval(() => {
        try {
          wavePhase += 0.42;
          setFaviconHref(drawProgress(progressValue, wavePhase));
        } catch {
          stopProgressAnimation();
        }
      }, 90);
    }
    setFaviconHref(drawProgress(progressValue, wavePhase));
  } catch {
    stopProgressAnimation();
  }
}

export function completeFaviconProgress() {
  if (typeof document === "undefined") return;
  progressActive = true;
  setFaviconProgress(100);
}

export function failFaviconProgress() {
  if (typeof document === "undefined") return;
  try {
    progressActive = true;
    stopProgressAnimation();
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#070908";
    ctx.fillRect(0, 0, 32, 32);
    ctx.strokeStyle = "#ff4569";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(9, 9);
    ctx.lineTo(23, 23);
    ctx.moveTo(23, 9);
    ctx.lineTo(9, 23);
    ctx.stroke();
    setFaviconHref(canvas.toDataURL("image/png"));
  } catch {
    stopProgressAnimation();
  }
}

export function resetFaviconProgress() {
  if (typeof document === "undefined") return;
  progressActive = false;
  stopProgressAnimation();
  applyNotificationBadge();
}

export function setFaviconNotificationCount(count) {
  notificationCount = Math.max(0, Number(count || 0));
  applyNotificationBadge();
}
