import React, { useState } from "react";
import { Chrome, LogOut, Menu, UserCircle, X } from "lucide-react";
import { api } from "../api.js";
import { translations } from "../i18n.js";

function LanguageToggle({ language, onLanguageChange }) {
  return (
    <div className="languageToggle" aria-label="Language">
      {["vi", "en"].map((item) => (
        <button
          key={item}
          type="button"
          className={language === item ? "active" : ""}
          onClick={() => onLanguageChange?.(item)}
        >
          {item.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export default function Navbar({
  user,
  page,
  setPage,
  onUserChange,
  onNavigate,
  adminMode = false,
  language = "vi",
  onLanguageChange
}) {
  const t = translations[language] || translations.vi;
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    onUserChange(null);
    onNavigate?.("/");
  }

  function googleHref() {
    const returnTo = window.location.pathname === "/" ? "/getlink" : window.location.pathname;
    return `http://localhost:5000/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`;
  }

  const tabs = [
    ["getlink", t.getlink],
    ["topup", t.topup],
    ["history", t.history],
    ["guide", t.guide]
  ];

  function closeMenu() {
    setMenuOpen(false);
    setAccountOpen(false);
  }

  function goHome() {
    closeMenu();
    onNavigate?.("/");
  }

  function goPage(key) {
    closeMenu();
    setPage(key);
  }

  function goPath(path) {
    closeMenu();
    onNavigate?.(path);
  }

  function toggleAccountMenu() {
    setAccountOpen((current) => !current);
  }

  return (
    <header className="topbar">
      <button className="brandButton" onClick={goHome}>
        3DiPL
      </button>
      <button
        type="button"
        className="mobileMenuButton"
        onClick={() => setMenuOpen((current) => !current)}
        aria-label="Menu"
        aria-expanded={menuOpen}
      >
        {menuOpen ? <X size={19} /> : <Menu size={19} />}
      </button>
      <div className={`topbarMenu ${menuOpen ? "open" : ""}`}>
        {!adminMode && (
          <nav className="tabs">
            {tabs.map(([key, label]) => {
              const targetPath = `/${key}`;
              return (
                <button 
                  key={key} 
                  className={page === key ? "active" : ""} 
                  onClick={() => {
                    if (!user && key !== "guide") {
                      window.location.href = `http://localhost:5000/api/auth/google?returnTo=${encodeURIComponent(targetPath)}`;
                    } else if (key === "guide") {
                      goPath("/guide");
                    } else {
                      goPage(key);
                    }
                  }}
                >
                  <span>[ {label} ]</span>
                </button>
              );
            })}
          </nav>
        )}
        {adminMode && <nav className="tabs" />}
        
        {user ? (
          <div className={`account ${accountOpen ? "open" : ""}`}>
            <button type="button" className="tabletAccountButton" onClick={toggleAccountMenu} aria-label="Account" aria-expanded={accountOpen}>
              <UserCircle size={16} />
              <strong>{user.credit}</strong>
            </button>
            <div className="accountMenuContent">
              <span>{user.name}</span>
              <strong>{user.credit} credit</strong>
              {user.role === "admin" && (
                <button className="adminLink" onClick={() => goPath("/admin")}>
                  {t.admin}
                </button>
              )}
              <LanguageToggle language={language} onLanguageChange={onLanguageChange} />
              <button className="iconButton" onClick={logout} title={t.logout}>
                <LogOut size={17} />
              </button>
            </div>
          </div>
        ) : (
          <div className="account">
            <a className="headerLoginButton" href={googleHref()}>
              <Chrome size={15} />
              {t.googleLogin}
            </a>
            <LanguageToggle language={language} onLanguageChange={onLanguageChange} />
          </div>
        )}
      </div>
    </header>
  );
}
