export function openDownloadWindow() {
  if (typeof window === "undefined") return null;
  const popup = window.open("about:blank", "_blank");
  if (!popup) return null;
  try {
    popup.document.title = "Preparing download";
    popup.document.body.innerHTML =
      "<pre style=\"font:14px monospace;padding:24px\">Dang chuan bi link tai...</pre>";
    popup.opener = null;
  } catch {
    // Some browsers restrict about:blank writes; navigation still works.
  }
  return popup;
}

export function triggerBrowserDownload(downloadUrl, popup = null) {
  if (!downloadUrl) {
    if (popup && !popup.closed) popup.close();
    return;
  }
  if (popup && !popup.closed) {
    popup.location.href = downloadUrl;
    return;
  }
  window.location.href = downloadUrl;
}

export function closeDownloadWindow(popup = null) {
  if (popup && !popup.closed) popup.close();
}
