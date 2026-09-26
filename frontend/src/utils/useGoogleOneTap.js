import { useEffect } from "react";
import { api } from "../api.js";

const PROMPTED_KEY = "3dipl-google-one-tap-prompted";
const SCRIPT_URL = "https://accounts.google.com/gsi/client";
let scriptPromise;
let initializedClientId = "";
let credentialCallback;

function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => window.google?.accounts?.id
        ? resolve(window.google.accounts.id)
        : reject(new Error("Google Identity Services is unavailable"));
      script.onerror = () => {
        script.remove();
        reject(new Error("Google Identity Services could not load"));
      };
      document.head.appendChild(script);
    }).catch((error) => {
      scriptPromise = null;
      throw error;
    });
  }
  return scriptPromise;
}

export function suppressGoogleOneTap() {
  window.google?.accounts?.id?.disableAutoSelect?.();
  try {
    window.sessionStorage.setItem(PROMPTED_KEY, "1");
  } catch {
    // Browser storage may be unavailable in private mode.
  }
}

export function useGoogleOneTap({ enabled, onAuthenticated }) {
  useEffect(() => {
    if (!enabled) return undefined;
    try {
      if (window.sessionStorage.getItem(PROMPTED_KEY) === "1") return undefined;
    } catch {
      // Continue without per-tab suppression when storage is unavailable.
    }

    let cancelled = false;
    const start = async () => {
      try {
        const config = await api("/api/auth/google/one-tap/config", { cache: "no-store" });
        if (cancelled || !config.enabled || !config.clientId) return;
        const googleIdentity = await loadGoogleIdentity();
        if (cancelled) return;

        credentialCallback = async (response) => {
          if (!response?.credential || cancelled) return;
          try {
            const ref = new URLSearchParams(window.location.search).get("ref") || "";
            await api("/api/auth/google/one-tap", {
              method: "POST",
              body: JSON.stringify({ credential: response.credential, ref }),
            });
            if (!cancelled) await onAuthenticated();
          } catch {
            // The existing Google sign-in button remains available.
          }
        };
        if (initializedClientId !== config.clientId) {
          googleIdentity.initialize({
            client_id: config.clientId,
            callback: (response) => credentialCallback?.(response),
            auto_select: false,
            cancel_on_tap_outside: true,
          });
          initializedClientId = config.clientId;
        }
        try {
          window.sessionStorage.setItem(PROMPTED_KEY, "1");
        } catch {
          // Google manages its own prompt cooldown when storage is unavailable.
        }
        googleIdentity.prompt();
      } catch {
        // A blocked Google script must not block the site.
      }
    };

    start();
    return () => {
      cancelled = true;
      window.google?.accounts?.id?.cancel?.();
    };
  }, [enabled, onAuthenticated]);
}
