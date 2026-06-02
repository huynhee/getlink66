import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api.js";
import Navbar from "./components/Navbar.jsx";
import Login from "./pages/Login.jsx";
import Home from "./pages/Home.jsx";
import Topup from "./pages/Topup.jsx";
import History from "./pages/History.jsx";
import Invite from "./pages/Invite.jsx";
import Admin from "./pages/Admin.jsx";
import Guide from "./pages/Guide.jsx";
import Privacy from "./pages/Privacy.jsx";
import Terms from "./pages/Terms.jsx";
import { getInitialLanguage, setStoredLanguage, translations } from "./i18n.js";
import "./styles.css";

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
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div className="panel" style={{ width: 400, background: "#111", border: "1px solid var(--border)" }}>
        <h2 style={{ marginBottom: 16 }}>{t.twoFactorTitle}</h2>
        <p style={{ marginBottom: 16, color: "var(--muted)" }}>{t.twoFactorBody}</p>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="text"
            placeholder={t.twoFactorPlaceholder}
            value={token}
            onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
            maxLength={6}
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
  if (pathname === "/topup") return "topup";
  if (pathname === "/history") return "history";
  if (pathname === "/invite") return "invite";
  if (pathname === "/admin") return "admin";
  if (pathname === "/guide") return "guide";
  if (pathname === "/privacy" || pathname === "/chinh-sach-bao-mat") return "privacy";
  if (pathname === "/terms" || pathname === "/dieu-khoan-su-dung") return "terms";
  if (pathname === "/") return "";
  return "getlink";
}

function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState(() => pageFromPath(window.location.pathname));
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState(window.location.pathname);
  const [language, setLanguage] = useState(getInitialLanguage);
  const [banOverlayClosed, setBanOverlayClosed] = useState(false);
  const isAdminPath = path === "/admin";
  const isPublicHome = path === "/";
  const t = translations[language];

  function changeLanguage(nextLanguage) {
    setLanguage(nextLanguage);
    setStoredLanguage(nextLanguage);
  }

  async function refreshUser() {
    const data = await api("/api/auth/user");
    setUser(data.user);
  }

  function navigate(nextPath) {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
    setPage(pageFromPath(nextPath));
  }

  function navigateByPage(nextPage) {
    const routes = {
      getlink: "/getlink",
      topup: "/topup",
      history: "/history",
      invite: "/invite",
      guide: "/guide"
    };
    navigate(routes[nextPage] || "/getlink");
  }

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setBanOverlayClosed(false);
  }, [user?._id, user?.isBanned]);

  useEffect(() => {
    const onPopState = () => {
      setPath(window.location.pathname);
      setPage(pageFromPath(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (loading) return <main className="center">{t.loading}</main>;

  if (isAdminPath) {
    return (
      <div className="appFrame">
        <Navbar user={user} page="admin" setPage={navigateByPage} onUserChange={setUser} onNavigate={navigate} adminMode language={language} onLanguageChange={changeLanguage} />
        <main className="shell">
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
      <div className="appFrame">
        <Navbar user={user} page="" setPage={navigateByPage} onUserChange={setUser} onNavigate={navigate} language={language} onLanguageChange={changeLanguage} />
        <FacebookGroupBanner language={language} />
        <main className="shell">
          <Login user={user} onLogin={refreshUser} returnTo="/" language={language} />
        </main>
        {user?.isBanned && !banOverlayClosed && (
          <BannedOverlay user={user} language={language} onClose={() => setBanOverlayClosed(true)} />
        )}
      </div>
    );
  }

  return (
    <div className="appFrame">
      <Navbar user={user} page={page} setPage={navigateByPage} onUserChange={setUser} onNavigate={navigate} language={language} onLanguageChange={changeLanguage} />
      <FacebookGroupBanner language={language} />
      <main className="shell">
        {!user && !["guide", "privacy", "terms"].includes(page) && <Login user={user} onLogin={refreshUser} returnTo="/" language={language} />}
        {page === "guide" && <Guide language={language} />}
        {page === "privacy" && <Privacy language={language} />}
        {page === "terms" && <Terms language={language} />}
        {user && page === "getlink" && <Home user={user} onUserChange={setUser} language={language} />}
        {user && page === "topup" && <Topup user={user} onUserChange={setUser} language={language} />}
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
    <App />
  </>,
);
