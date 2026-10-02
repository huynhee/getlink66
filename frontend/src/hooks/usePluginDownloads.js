import { useCallback, useEffect, useState } from "react";
import { apiCached, buildApiUrl } from "../api.js";

export const PLUGIN_DOWNLOADS_PATH = "/api/plugin/downloads";

export function safePluginDownloadUrl(value) {
  const url = typeof value === "string" ? value.trim() : "";
  if (!url || url.includes("\\") || [...url].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return "";
  if (url.startsWith("/") && !url.startsWith("//")) return buildApiUrl(url);
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : "";
  } catch {
    return "";
  }
}

export default function usePluginDownloads() {
  const [state, setState] = useState({ loading: true, available: false, releases: [], channel: "", reason: "", error: "" });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, available: false, error: "" }));
    apiCached(PLUGIN_DOWNLOADS_PATH, { ttlMs: 30_000, force: revision > 0 })
      .then((data) => {
        if (!active) return;
        const releases = (Array.isArray(data.releases) ? data.releases : [])
          .filter((release) => release && typeof release.maxFamily === "string" && typeof release.version === "string")
          .map((release) => ({ ...release, downloadUrl: safePluginDownloadUrl(release.downloadUrl) }))
          .filter((release) => release.downloadUrl);
        setState({ loading: false, available: data.available === true && releases.length > 0, releases, channel: data.channel || "", reason: data.reason || "", error: "" });
      })
      .catch((error) => {
        if (active) setState({ loading: false, available: false, releases: [], channel: "", reason: "", error: error.message });
      });
    return () => { active = false; };
  }, [revision]);

  return { ...state, refresh };
}
