import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api.js";
import Navbar from "./components/Navbar.jsx";
import Login from "./pages/Login.jsx";
import Home from "./pages/Home.jsx";
import Topup from "./pages/Topup.jsx";
import History from "./pages/History.jsx";
import Admin from "./pages/Admin.jsx";
import Guide from "./pages/Guide.jsx";
import { getInitialLanguage, setStoredLanguage, translations } from "./i18n.js";
import "./styles.css";

function TwoFactorModal({ onVerify }) {
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
        <h2 style={{ marginBottom: 16 }}>Bảo mật 2 lớp (2FA)</h2>
        <p style={{ marginBottom: 16, color: "var(--muted)" }}>Vui lòng nhập mã xác nhận 6 số từ Google Authenticator để tiếp tục phiên quản trị.</p>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input 
            type="text" 
            placeholder="Ví dụ: 123456" 
            value={token} 
            onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))} 
            maxLength={6} 
            required 
            style={{ fontSize: 24, letterSpacing: 8, textAlign: "center", height: 50 }}
            autoFocus
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={loading || token.length < 6}>
            {loading ? "Đang kiểm tra..." : "Xác nhận"}
          </button>
        </form>
      </div>
    </div>
  );
}

function pageFromPath(pathname) {
  if (pathname === "/topup") return "topup";
  if (pathname === "/history") return "history";
  if (pathname === "/admin") return "admin";
  if (pathname === "/guide") return "guide";
  return "getlink";
}

function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState(() => pageFromPath(window.location.pathname));
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState(window.location.pathname);
  const [language, setLanguage] = useState(getInitialLanguage);
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
      guide: "/guide"
    };
    navigate(routes[nextPage] || "/getlink");
  }

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, []);

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
          {user?.requires2FA && <TwoFactorModal onVerify={refreshUser} />}
          {!user && <Login onLogin={refreshUser} adminMode returnTo="/admin" language={language} />}
          {user?.role === "admin" && !user?.requires2FA && <Admin user={user} language={language} />}
          {user && user.role !== "admin" && (
            <section className="panel emptyState">
              <h2>{t.adminRequiredTitle}</h2>
              <p>{t.adminRequiredBody}</p>
            </section>
          )}
        </main>
      </div>
    );
  }

  if (isPublicHome) {
    return (
      <div className="appFrame">
        <Navbar user={user} page="" setPage={navigateByPage} onUserChange={setUser} onNavigate={navigate} language={language} onLanguageChange={changeLanguage} />
        <main className="shell">
          <Login user={user} onLogin={refreshUser} returnTo="/getlink" language={language} />
        </main>
      </div>
    );
  }

  return (
    <div className="appFrame">
      <Navbar user={user} page={page} setPage={navigateByPage} onUserChange={setUser} onNavigate={navigate} language={language} onLanguageChange={changeLanguage} />
      <main className="shell">
        {!user && page !== "guide" && <Login user={user} onLogin={refreshUser} returnTo={path} language={language} />}
        {page === "guide" && <Guide language={language} />}
        {user && page === "getlink" && <Home user={user} onUserChange={setUser} language={language} />}
        {user && page === "topup" && <Topup user={user} onUserChange={setUser} language={language} />}
        {user && page === "history" && <History language={language} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
