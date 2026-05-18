let originalHref = "";
let favico = null;
let notificationCount = 0;
let progressActive = false;

function faviconLink() {
  let link =
    document.querySelector("link[rel='icon']") ||
    document.querySelector("link[rel='shortcut icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  if (!originalHref) originalHref = link.href || "";
  return link;
}

function favicoInstance() {
  if (typeof window === "undefined" || !window.Favico) return null;
  if (!favico) {
    faviconLink();
    favico = new window.Favico({
      animation: "popFade",
      bgColor: "#00c853",
      textColor: "#ffffff",
      type: "rectangle",
      position: "down",
    });
  }
  return favico;
}

function drawProgress(value) {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  const progress = Math.max(0, Math.min(100, Number(value || 0)));

  ctx.fillStyle = "#070908";
  ctx.fillRect(0, 0, 32, 32);
  ctx.strokeStyle = "rgba(0,255,136,0.34)";
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, 28, 28);

  ctx.fillStyle = "#00ff88";
  ctx.fillRect(6, 24 - Math.round(progress * 0.18), 20, Math.max(2, Math.round(progress * 0.18)));

  return canvas.toDataURL("image/png");
}

function drawBadge(count) {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  const text = count > 99 ? "99+" : String(count);

  ctx.fillStyle = "#070908";
  ctx.fillRect(0, 0, 32, 32);
  ctx.strokeStyle = "rgba(0,255,136,0.32)";
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, 28, 28);

  ctx.fillStyle = "#00c853";
  ctx.beginPath();
  ctx.roundRect(14, 16, 17, 14, 4);
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
  const favicoApi = favicoInstance();
  if (favicoApi) {
    if (count > 0) favicoApi.badge(count);
    else favicoApi.reset();
    return;
  }
  if (count > 0) faviconLink().href = drawBadge(count);
  else if (originalHref) faviconLink().href = originalHref;
}

export function setFaviconProgress(value) {
  if (typeof document === "undefined") return;
  const progress = Math.max(0, Math.min(100, Math.round(Number(value || 0))));
  progressActive = true;

  if (favico) favico.reset();

  if (window.FavIconX?.setValue) {
    window.FavIconX.config?.({
      shape: "square",
      animated: true,
      animationSpeed: 500,
      updateTitle: false,
      borderColor: "#00ff88",
      fillColor: "#00ff88",
      shadowColor: "rgba(0,255,136,0.35)",
    });
    window.FavIconX.setValue(progress);
    return;
  }

  faviconLink().href = drawProgress(progress);
}

export function completeFaviconProgress() {
  if (typeof document === "undefined") return;
  progressActive = true;
  if (window.FavIconX?.complete) {
    window.FavIconX.complete();
    return;
  }
  setFaviconProgress(100);
}

export function failFaviconProgress() {
  if (typeof document === "undefined") return;
  progressActive = true;
  if (window.FavIconX?.fail) {
    window.FavIconX.fail();
    return;
  }
  const link = faviconLink();
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
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
  link.href = canvas.toDataURL("image/png");
}

export function resetFaviconProgress() {
  if (typeof document === "undefined") return;
  progressActive = false;
  if (window.FavIconX?.reset) {
    window.FavIconX.reset();
    applyNotificationBadge();
    return;
  }
  const favicoApi = favicoInstance();
  if (favicoApi) {
    if (notificationCount > 0) favicoApi.badge(notificationCount);
    else favicoApi.reset();
    return;
  }
  applyNotificationBadge();
}

export function setFaviconNotificationCount(count) {
  notificationCount = Math.max(0, Number(count || 0));
  applyNotificationBadge();
}
