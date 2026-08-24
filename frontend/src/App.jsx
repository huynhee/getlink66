import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageCircle } from "lucide-react";
import { api } from "./api.js";
import Navbar from "./components/Navbar.jsx";
import Login from "./pages/Login.jsx";
import Home from "./pages/Home.jsx";
import Topup from "./pages/Topup.jsx";
import Models from "./pages/Models.jsx";
import Scenes from "./pages/Scenes.jsx";
import Membership from "./pages/Membership.jsx";
import History from "./pages/History.jsx";
import Invite from "./pages/Invite.jsx";
import Admin from "./pages/Admin.jsx";
import Guide from "./pages/Guide.jsx";
import Privacy from "./pages/Privacy.jsx";
import Terms from "./pages/Terms.jsx";
import PluginAccess from "./pages/PluginAccess.jsx";
import { GetlinkJobProvider, useGetlinkJob } from "./contexts/GetlinkJobContext.jsx";
import { getInitialLanguage, setStoredLanguage, translations } from "./i18n.js";
import "./styles.css";
import "./design-system.css";

const MESSENGER_URL = "https://m.me/1079508495252841";
const THEME_STORAGE_KEY = "3dipl-theme";
const USER_SYNC_CHANNEL_NAME = "3dipl-user-sync";
const USER_SYNC_STORAGE_KEY = "3dipl-user-sync-event";
const USER_SYNC_INTERVAL_MS = 15_000;
const USER_SYNC_PAYMENT_INTERVAL_MS = 3_000;
const THEME_META_COLORS = {
  dark: "#0a0a0a",
  light: "#faf8f5"
};
const SEO_ORIGIN = "https://3dipl.org";
const PRIVATE_SEO_PATHS = new Set([
  "/admin",
  "/getlink",
  "/history",
  "/invite",
  "/membership",
  "/plugin/activate",
  "/plugin/sessions",
  "/plugin/challenge",
  "/topup",
]);

function seoMetadata(pathname = "/", language = "vi") {
  const isVi = language === "vi";
  const canonicalPath = pathname === "/chinh-sach-bao-mat"
    ? "/privacy"
    : pathname === "/dieu-khoan-su-dung"
      ? "/terms"
      : pathname;
  const pageKey = canonicalPath.startsWith("/models/")
    ? "/models"
    : canonicalPath.startsWith("/scenes/")
      ? "/scenes"
      : canonicalPath;
  const pages = {
    "/": {
      vi: ["3DIPL - Model 3D & Getlink", "Thư viện Model, Scene 3D và dịch vụ Getlink."],
      en: ["3DIPL - 3D Model & Getlink", "3D Model, Scene and Getlink."],
    },
    "/models": {
      vi: ["Thư viện Model 3D | 3DIPL", "Tìm kiếm và tải Model 3D Free hoặc Pro theo danh mục, renderer và phong cách."],
      en: ["3D Model Library | 3DIPL", "Search and download Free or Pro 3D Models by category, renderer, and style."],
    },
    "/scenes": {
      vi: ["Thư viện Scene 3D | 3DIPL", "Tìm kiếm và tải Scene 3D Free hoặc Pro theo không gian, renderer và phong cách."],
      en: ["3D Scene Library | 3DIPL", "Search and download Free or Pro 3D Scenes by space, renderer, and style."],
    },
    "/guide": {
      vi: ["Hướng dẫn sử dụng | 3DIPL", "Hướng dẫn sử dụng Model, Scene, Getlink, Credit và gói Pro trên 3DIPL."],
      en: ["User Guides | 3DIPL", "Guides for Models, Scenes, Getlink, Credit, and Pro plans on 3DIPL."],
    },
    "/privacy": {
      vi: ["Chính sách bảo mật | 3DIPL", "Chính sách bảo mật và xử lý dữ liệu của 3DIPL."],
      en: ["Privacy Policy | 3DIPL", "The 3DIPL privacy and data processing policy."],
    },
    "/terms": {
      vi: ["Điều khoản sử dụng | 3DIPL", "Điều khoản sử dụng dịch vụ 3DIPL."],
      en: ["Terms of Use | 3DIPL", "Terms governing the use of 3DIPL services."],
    },
  };
  const fallback = isVi
    ? ["3DIPL - Thư viện 3D", "Thư viện Model và Scene 3D trên 3DIPL."]
    : ["3DIPL - 3D Library", "A library of 3D Models and Scenes on 3DIPL."];
  const [title, description] = pages[pageKey]?.[isVi ? "vi" : "en"] || fallback;
  return {
    canonicalUrl: `${SEO_ORIGIN}${canonicalPath === "/" ? "/" : canonicalPath}`,
    description,
    noIndex: PRIVATE_SEO_PATHS.has(canonicalPath),
    title,
  };
}

function upsertMeta(selector, attributes) {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
  return element;
}

function isValidTheme(value) {
  return value === "light" || value === "dark";
}

function getStoredTheme() {
  if (typeof window === "undefined") return "";
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isValidTheme(storedTheme) ? storedTheme : "";
  } catch {
    return "";
  }
}

function getSystemTheme() {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function getInitialTheme() {
  if (typeof window === "undefined") return "dark";
  return getStoredTheme() || getSystemTheme();
}

function applyTheme(nextTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute("content", THEME_META_COLORS[nextTheme] || THEME_META_COLORS.dark);
  }
}

function userStateSignature(user) {
  if (!user) return "";
  return JSON.stringify({
    _id: String(user._id || ""),
    name: user.name || "",
    email: user.email || "",
    avatar: user.avatar || "",
    role: user.role || "",
    credit: Number(user.credit || 0),
    proUntil: user.proUntil || null,
    isPro: Boolean(user.isPro),
    proDailyDownloadLimit: Number(user.proDailyDownloadLimit || 0),
    isBanned: Boolean(user.isBanned),
    banReason: user.banReason || "",
    isTwoFactorEnabled: Boolean(user.isTwoFactorEnabled),
    requires2FA: Boolean(user.requires2FA),
    downloadQuota: user.downloadQuota || null,
  });
}

function hasPendingPayment() {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(
      window.sessionStorage.getItem("pendingSepayTopupId")
      || window.sessionStorage.getItem("pendingMembershipOrderId"),
    );
  } catch {
    return false;
  }
}

function MessengerFloatButton() {
  return (
    <a
      className="messengerFloat"
      href={MESSENGER_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="Chat Messenger"
    >
      <MessageCircle size={20} aria-hidden="true" />
    </a>
  );
}

function FacebookGroupBanner({ language = "vi" }) {
  const t = translations[language] || translations.vi;
  return (
    <a
      className="facebookGroupBanner"
      href="https://www.facebook.com/groups/960223243551548"
      target="_blank"
      rel="noreferrer"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06C2 17.08 5.66 21.25 10.44 22v-7.03H7.9v-2.91h2.54V9.84c0-2.52 1.49-3.91 3.77-3.91 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.9h2.78l-.44 2.91h-2.34V22C18.34 21.25 22 17.08 22 12.06Z" />
      </svg>
      <span>
        {t.facebookGroupBanner} <span className="arrow">»</span>
      </span>
    </a>
  );
}

function TwoFactorModal({ onVerify, language = "vi" }) {
  const t = translations[language] || translations.vi;
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api("/api/auth/2fa/verify", {
        method: "POST",
        body: JSON.stringify({ token })
      });
      onVerify();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="twoFactorOverlay">
      <div className="panel twoFactorCard">
        <h2 style={{ marginBottom: 16 }}>{t.twoFactorTitle}</h2>
        <p style={{ marginBottom: 16, color: "var(--muted)" }}>{t.twoFactorBody}</p>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="text"
            placeholder={t.twoFactorPlaceholder}
            value={token}
            onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            style={{ fontSize: 24, letterSpacing: 8, textAlign: "center", height: 50 }}
            autoFocus
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={loading || token.length < 6}>
            {loading ? t.checking : t.confirm}
          </button>
        </form>
      </div>
    </div>
  );
}

function BannedOverlay({ user, onClose, language = "vi" }) {
  const title = language === "vi" ? "Tài khoản đã bị ban" : "Account banned";
  const body =
    user?.banReason ||
    (language === "vi"
      ? "Tài khoản của bạn đã bị khóa quyền getlink."
      : "Your account can no longer use getlink.");

  return (
    <div className="banOverlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="banOverlayCard">
        <button type="button" className="banOverlayClose" onClick={onClose} aria-label="Close">×</button>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    </div>
  );
}

function pageFromPath(pathname) {
  const cleanPath = String(pathname || "/").split(/[?#]/)[0] || "/";
  if (cleanPath === "/models" || cleanPath.startsWith("/models/")) return "models";
  if (cleanPath === "/scenes" || cleanPath.startsWith("/scenes/")) return "scenes";
  if (cleanPath === "/membership") return "membership";
  if (cleanPath === "/topup") return "topup";
  if (cleanPath === "/history") return "history";
  if (cleanPath === "/invite") return "invite";
  if (cleanPath === "/admin") return "admin";
  if (cleanPath === "/guide") return "guide";
  if (cleanPath === "/privacy" || cleanPath === "/chinh-sach-bao-mat") return "privacy";
  if (cleanPath === "/terms" || cleanPath === "/dieu-khoan-su-dung") return "terms";
  if (cleanPath === "/plugin/activate") return "pluginActivate";
  if (cleanPath === "/plugin/sessions") return "pluginSessions";
  if (cleanPath === "/plugin/challenge") return "pluginChallenge";
  if (cleanPath === "/") return "";
  return "getlink";
}

function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState(() => pageFromPath(window.location.pathname));
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState(`${window.location.pathname}${window.location.search}`);
  const [language, setLanguage] = useState(getInitialLanguage);
  const [theme, setTheme] = useState(getInitialTheme);
  const [banOverlayClosed, setBanOverlayClosed] = useState(false);
  const previousUserIdRef = useRef("");
  const userRef = useRef(null);
  const userMutationVersionRef = useRef(0);
  const userRefreshPromiseRef = useRef(null);
  const userSyncChannelRef = useRef(null);
  const userSyncTabIdRef = useRef(
    globalThis.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const isAdminPath = path === "/admin";
  const isPublicHome = path === "/";
  const t = translations[language];
  const { job: getlinkJob, setIdentity: setGetlinkJobIdentity, setRoute: setGetlinkJobRoute } = useGetlinkJob();

  function changeLanguage(nextLanguage) {
    setLanguage(nextLanguage);
    setStoredLanguage(nextLanguage);
  }

  function toggleTheme() {
    setTheme((current) => {
      const nextTheme = current === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      } catch {
        // The visual preference still applies for this session if storage is blocked.
      }
      return nextTheme;
    });
  }

  const commitUser = useCallback((nextUser, { merge = false, localMutation = false } = {}) => {
    const current = userRef.current;
    const candidate = typeof nextUser === "function" ? nextUser(current) : nextUser;
    const resolved = merge
      && current
      && candidate
      && String(current._id || "") === String(candidate._id || "")
      ? { ...current, ...candidate }
      : candidate;

    if (localMutation) userMutationVersionRef.current += 1;
    userRef.current = resolved || null;
    setUser((previous) => (
      userStateSignature(previous) === userStateSignature(resolved) ? previous : (resolved || null)
    ));
    return resolved || null;
  }, []);

  const publishUserRefresh = useCallback((nextUser) => {
    const payload = {
      type: "refresh-user",
      source: userSyncTabIdRef.current,
      userId: String(nextUser?._id || ""),
      at: Date.now(),
    };
    userSyncChannelRef.current?.postMessage(payload);
    try {
      window.localStorage.setItem(USER_SYNC_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // BroadcastChannel remains available when storage access is blocked.
    }
  }, []);

  const handleUserChange = useCallback((nextUser) => {
    const resolved = commitUser(nextUser, { merge: true, localMutation: true });
    publishUserRefresh(resolved);
  }, [commitUser, publishUserRefresh]);

  const refreshUser = useCallback(async () => {
    if (userRefreshPromiseRef.current) return userRefreshPromiseRef.current;
    const mutationVersion = userMutationVersionRef.current;
    const request = api("/api/auth/user", { cache: "no-store" })
      .then((data) => {
        // A response started before a local debit/credit must not overwrite it.
        if (mutationVersion !== userMutationVersionRef.current) return userRef.current;
        return commitUser(data.user, { merge: false });
      })
      .finally(() => {
        if (userRefreshPromiseRef.current === request) userRefreshPromiseRef.current = null;
      });
    userRefreshPromiseRef.current = request;
    return request;
  }, [commitUser]);

  function navigate(nextPath) {
    window.history.pushState({}, "", nextPath);
    const nextUrl = new URL(nextPath, window.location.origin);
    setPath(`${nextUrl.pathname}${nextUrl.search}`);
    setPage(pageFromPath(nextUrl.pathname));
  }

  function navigateByPage(nextPage) {
    const routes = {
      getlink: "/getlink",
      topup: "/topup",
      models: "/models",
      scenes: "/scenes",
      membership: "/membership",
      history: "/history",
      invite: "/invite",
      guide: "/guide"
    };
    navigate(routes[nextPage] || "/getlink");
  }

  useEffect(() => {
    refreshUser()
      .catch(() => commitUser(null))
      .finally(() => setLoading(false));
  }, [commitUser, refreshUser]);

  useEffect(() => {
    const receiveSyncSignal = (payload) => {
      if (!payload || payload.type !== "refresh-user" || payload.source === userSyncTabIdRef.current) return;
      refreshUser().catch(() => {});
    };
    const handleStorage = (event) => {
      if (event.key !== USER_SYNC_STORAGE_KEY || !event.newValue) return;
      try {
        receiveSyncSignal(JSON.parse(event.newValue));
      } catch {
        // Ignore malformed or stale cross-tab messages.
      }
    };

    if (typeof BroadcastChannel === "function") {
      const channel = new BroadcastChannel(USER_SYNC_CHANNEL_NAME);
      channel.onmessage = (event) => receiveSyncSignal(event.data);
      userSyncChannelRef.current = channel;
    }
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      userSyncChannelRef.current?.close();
      userSyncChannelRef.current = null;
    };
  }, [refreshUser]);

  useEffect(() => {
    if (!user?._id) return undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshUser().catch(() => {});
    };
    const intervalMs = page === "topup" || hasPendingPayment()
      ? USER_SYNC_PAYMENT_INTERVAL_MS
      : USER_SYNC_INTERVAL_MS;
    const timer = window.setInterval(refreshWhenVisible, intervalMs);
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    refreshWhenVisible();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("pageshow", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [page, refreshUser, user?._id]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const pathname = window.location.pathname || "/";
    const metadata = seoMetadata(pathname, language);
    document.title = metadata.title;

    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", metadata.canonicalUrl);

    upsertMeta('meta[name="description"]', { name: "description", content: metadata.description });
    upsertMeta('meta[name="robots"]', {
      name: "robots",
      content: metadata.noIndex ? "noindex, nofollow" : "index, follow",
    });
    upsertMeta('meta[property="og:title"]', { property: "og:title", content: metadata.title });
    upsertMeta('meta[property="og:description"]', { property: "og:description", content: metadata.description });
    upsertMeta('meta[property="og:url"]', { property: "og:url", content: metadata.canonicalUrl });
  }, [language, path]);

  useEffect(() => {
    if (getStoredTheme() || typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }
    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const syncSystemTheme = () => {
      if (!getStoredTheme()) setTheme(mediaQuery.matches ? "light" : "dark");
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", syncSystemTheme);
      return () => mediaQuery.removeEventListener("change", syncSystemTheme);
    }
    mediaQuery.addListener(syncSystemTheme);
    return () => mediaQuery.removeListener(syncSystemTheme);
  }, []);

  useEffect(() => {
    setBanOverlayClosed(false);
  }, [user?._id, user?.isBanned]);

  useEffect(() => {
    setGetlinkJobIdentity(user?._id || "");
  }, [setGetlinkJobIdentity, user?._id]);

  useEffect(() => {
    const previousUserId = previousUserIdRef.current;
    const currentUserId = String(user?._id || "");
    if (previousUserId && !currentUserId) {
      try {
        window.localStorage.removeItem(`3dipl-getlink-draft:${previousUserId}`);
        window.localStorage.removeItem(`3dipl-getlink-draft:${previousUserId}:request-id`);
      } catch {
        // Logout cleanup is best effort only.
      }
    }
    previousUserIdRef.current = currentUserId;
  }, [user?._id]);

  useEffect(() => {
    setGetlinkJobRoute(page);
  }, [page, setGetlinkJobRoute]);

  useEffect(() => {
    const nextCredit = Number(getlinkJob?.result?.credit);
    if (!user?._id || !Number.isFinite(nextCredit) || Number(user.credit) === nextCredit) return;
    handleUserChange((current) => current?._id === user._id ? { ...current, credit: nextCredit } : current);
  }, [getlinkJob?.result?.credit, handleUserChange, user?._id, user?.credit]);

  useEffect(() => {
    const onPopState = () => {
      setPath(`${window.location.pathname}${window.location.search}`);
      setPage(pageFromPath(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (loading) return <main className="center">{t.loading}</main>;

  if (isAdminPath) {
    return (
      <div className="appFrame page-admin">
        <Navbar user={user} page="admin" setPage={navigateByPage} onUserChange={handleUserChange} onNavigate={navigate} language={language} onLanguageChange={changeLanguage} theme={theme} onThemeToggle={toggleTheme} />
        <main className="shell shell-admin">
          {user?.requires2FA && <TwoFactorModal onVerify={refreshUser} language={language} />}
          {!user && <Login onLogin={refreshUser} adminMode returnTo="/admin" language={language} />}
          {user?.role === "admin" && !user?.requires2FA && <Admin user={user} language={language} />}
          {user && user.role !== "admin" && (
            <section className="panel emptyState">
              <h2>{t.adminRequiredTitle}</h2>
              <p>{t.adminRequiredBody}</p>
            </section>
          )}
        </main>
        {user?.isBanned && !banOverlayClosed && (
          <BannedOverlay user={user} language={language} onClose={() => setBanOverlayClosed(true)} />
        )}
      </div>
    );
  }

  if (isPublicHome) {
    return (
      <div className="appFrame page-home">
        <Navbar user={user} page="" setPage={navigateByPage} onUserChange={handleUserChange} onNavigate={navigate} language={language} onLanguageChange={changeLanguage} theme={theme} onThemeToggle={toggleTheme} />
        <FacebookGroupBanner language={language} />
        <main className="shell shell-home">
          <Login user={user} onLogin={refreshUser} returnTo="/" language={language} />
        </main>
        {user?.isBanned && !banOverlayClosed && (
          <BannedOverlay user={user} language={language} onClose={() => setBanOverlayClosed(true)} />
        )}
      </div>
    );
  }

  return (
    <div className={`appFrame page-${page || "getlink"}`}>
      <Navbar user={user} page={page} setPage={navigateByPage} onUserChange={handleUserChange} onNavigate={navigate} language={language} onLanguageChange={changeLanguage} theme={theme} onThemeToggle={toggleTheme} />
      <FacebookGroupBanner language={language} />
      <main className={`shell shell-${page || "getlink"}${page === "scenes" && path.startsWith("/scenes/") ? " shell-scene-detail" : ""}`}>
        {!user && !["guide", "privacy", "terms", "models", "scenes"].includes(page) && <Login user={user} onLogin={refreshUser} returnTo={path || "/"} language={language} />}
        {page === "models" && <Models user={user} language={language} path={path} onNavigate={navigate} onUserChange={handleUserChange} />}
        {page === "scenes" && <Scenes user={user} language={language} path={path} onNavigate={navigate} onUserChange={handleUserChange} />}
        {page === "guide" && <Guide language={language} />}
        {page === "privacy" && <Privacy language={language} />}
        {page === "terms" && <Terms language={language} />}
        {user && page === "pluginActivate" && <PluginAccess language={language} mode="activate" />}
        {user && page === "pluginSessions" && <PluginAccess language={language} mode="sessions" />}
        {user && page === "pluginChallenge" && <PluginAccess language={language} mode="challenge" />}
        {user && page === "getlink" && <Home user={user} onUserChange={handleUserChange} language={language} />}
        {user && page === "topup" && <Topup user={user} onUserChange={handleUserChange} language={language} />}
        {user && page === "membership" && <Membership user={user} onUserChange={handleUserChange} language={language} />}
        {user && page === "history" && <History language={language} />}
        {user && page === "invite" && <Invite language={language} />}
      </main>
      {user?.isBanned && !banOverlayClosed && (
        <BannedOverlay user={user} language={language} onClose={() => setBanOverlayClosed(true)} />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <>
    <div className="cyber-scanlines" aria-hidden="true" />
    <GetlinkJobProvider>
      <App />
    </GetlinkJobProvider>
    <MessengerFloatButton />
  </>,
);
