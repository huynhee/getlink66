import React, { useEffect, useState } from "react";
import { Bell, CalendarClock, Chrome, Download, LogOut, Menu, Moon, Sun, UserCircle, Wallet, X } from "lucide-react";
import { API_URL, api } from "../api.js";
import CoinAmount from "./CoinAmount.jsx";
import { translations } from "../i18n.js";
import { setFaviconNotificationCount } from "../utils/faviconProgress.js";

function LanguageToggle({ language, onLanguageChange }) {
  const nextLanguage = language === "vi" ? "en" : "vi";
  const currentLanguage = language === "vi" ? "vi" : "en";
  const label = `Switch to ${nextLanguage.toUpperCase()}`;
  return (
    <button
      type="button"
      className="iconButton languageSingleToggle"
      onClick={() => onLanguageChange?.(nextLanguage)}
      title={label}
      aria-label={label}
    >
      <span>{currentLanguage.toUpperCase()}</span>
    </button>
  );
}

function ThemeToggle({ theme = "dark", onThemeToggle }) {
  const isLight = theme === "light";
  const label = isLight ? "Switch to dark mode" : "Switch to light mode";
  return (
    <button
      type="button"
      className="iconButton themeToggle"
      onClick={onThemeToggle}
      title={label}
      aria-label={label}
    >
      {isLight ? <Moon size={17} /> : <Sun size={17} />}
    </button>
  );
}

function formatProUntil(user, language) {
  if (!user?.isPro || !user.proUntil) return language === "vi" ? "Chưa kích hoạt" : "Not active";
  return new Date(user.proUntil).toLocaleString(language === "vi" ? "vi-VN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function downloadQuotaText(user, language) {
  const quota = user?.downloadQuota;
  if (!quota) return language === "vi" ? "Chưa có dữ liệu" : "No data";
  if (quota.tier === "admin" || quota.limit === null) return language === "vi" ? "Không giới hạn" : "Unlimited";
  return `${Number(quota.used || 0)}/${Number(quota.limit || 0)} ${language === "vi" ? "lượt" : "downloads"}`;
}

function downloadQuotaHint(user, language) {
  const quota = user?.downloadQuota;
  if (!quota || quota.tier === "admin" || quota.limit === null) return "";
  const remaining = Number(quota.remaining || 0);
  return language === "vi" ? `Còn ${remaining} lượt hôm nay` : `${remaining} remaining today`;
}

export default function Navbar({
  user,
  page,
  setPage,
  onUserChange,
  onNavigate,
  adminMode = false,
  language = "vi",
  onLanguageChange,
  theme = "dark",
  onThemeToggle
}) {
  const t = translations[language] || translations.vi;
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [sessionHiddenFullscreenIds, setSessionHiddenFullscreenIds] = useState(() => new Set());
  const unreadCount = notifications.filter(
    (item) => item.displayType !== "fullscreen" && !item.isRead
  ).length;
  const fullscreenNotification = notifications.find(
    (item) => item.displayType === "fullscreen" && !sessionHiddenFullscreenIds.has(item._id)
  );

  useEffect(() => {
    let cancelled = false;
    async function loadNotifications() {
      if (!user) {
        setNotifications([]);
        return;
      }
      try {
        const data = await api("/api/notifications");
        if (!cancelled) setNotifications(data.notifications || []);
      } catch {
        if (!cancelled) setNotifications([]);
      }
    }
    loadNotifications();
    const timer = user ? window.setInterval(loadNotifications, 60_000) : null;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [user?._id]);

  useEffect(() => {
    setFaviconNotificationCount(unreadCount);
  }, [unreadCount]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    onUserChange(null);
    onNavigate?.("/");
  }

  function googleHref(returnToOverride = "") {
    const returnTo = returnToOverride || (window.location.pathname === "/" ? "/" : window.location.pathname);
    const params = new URLSearchParams({ returnTo });
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) params.set("ref", ref);
    return `${API_URL}/api/auth/google?${params.toString()}`;
  }

  const tabs = [
    ["models", language === "vi" ? "Model" : "Models"],
    ["getlink", t.getlink],
    ["topup", language === "vi" ? "Gói nạp" : "Top-up"],
    ["invite", language === "vi" ? "Mời bạn" : "Invite friends"],
    ["history", t.history],
    ["guide", t.guide]
  ];

  function closeMenu() {
    setMenuOpen(false);
    setAccountOpen(false);
    setNotificationOpen(false);
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
    setNotificationOpen(false);
  }

  async function markNotificationRead(id) {
    setNotifications((items) =>
      items.map((item) => (item._id === id ? { ...item, isRead: true } : item))
    );
    try {
      await api(`/api/notifications/${id}/read`, { method: "POST" });
    } catch {
      // UI can stay read locally; next poll will correct it if the request failed.
    }
  }

  function goNotificationAction(item) {
    if (!item) return;
    markNotificationRead(item._id);
    const actionUrl = String(item.actionUrl || "").trim();
    if (!actionUrl) return;
    if (actionUrl.startsWith("/")) {
      closeMenu();
      onNavigate?.(actionUrl);
      return;
    }
    window.location.href = actionUrl;
  }

  function closeFullscreenNotification(id) {
    if (!id) return;
    setSessionHiddenFullscreenIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  function goFullscreenAction(item) {
    if (!item) return;
    closeFullscreenNotification(item._id);
    const actionUrl = String(item.actionUrl || "").trim();
    if (!actionUrl) return;
    if (actionUrl.startsWith("/")) {
      closeMenu();
      onNavigate?.(actionUrl);
      return;
    }
    window.location.href = actionUrl;
  }

  return (
    <>
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
                    if (!user && !["guide", "models"].includes(key)) {
                      window.location.href = googleHref("/");
                    } else if (key === "guide") {
                      goPath("/guide");
                    } else if (key === "models") {
                      goPath("/models");
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
            <div className={`notificationMenu ${notificationOpen ? "open" : ""}`}>
              <button
                type="button"
                className="notificationButton"
                onClick={() => {
                  setNotificationOpen((current) => !current);
                  setAccountOpen(false);
                }}
                aria-label={t.notifications}
                aria-expanded={notificationOpen}
              >
                <Bell size={16} />
                {unreadCount > 0 && <span>{unreadCount}</span>}
              </button>
              <div className="notificationDropdown">
                <strong>{t.notifications}</strong>
                {notifications.slice(0, 8).map((item) => (
                  <button
                    key={item._id}
                    type="button"
                    className={item.isRead ? "read" : ""}
                    onClick={() => markNotificationRead(item._id)}
                  >
                    <b>{item.title}</b>
                    <span>{item.body}</span>
                    <time>{new Date(item.createdAt).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}</time>
                  </button>
                ))}
                {!notifications.length && <p>{t.noNotifications}</p>}
              </div>
            </div>
            <ThemeToggle theme={theme} onThemeToggle={onThemeToggle} />
            <LanguageToggle language={language} onLanguageChange={onLanguageChange} />
            <button
              type="button"
              className="accountCreditPill"
              onClick={() => goPath("/topup?mode=credit")}
              title={language === "vi" ? "Nạp credit" : "Top up credits"}
            >
              <Wallet size={15} />
              <strong><CoinAmount value={user.credit} className="compact" /></strong>
            </button>
            <button
              type="button"
              className="accountTrigger"
              onClick={toggleAccountMenu}
              aria-label={language === "vi" ? "Trạng thái tài khoản" : "Account status"}
              aria-expanded={accountOpen}
            >
              <span className="accountAvatar" aria-hidden="true">
                {user.avatar ? (
                  <img src={user.avatar} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <UserCircle size={22} />
                )}
              </span>
              <span className="accountIdentity">
                <span>{user.name || user.email}</span>
                <small>{user.isPro ? "PRO" : "FREE"}</small>
              </span>
            </button>
            <div className="accountMenuContent">
              <div className="accountStatusHeader">
                <span className="accountAvatar large" aria-hidden="true">
                  {user.avatar ? (
                    <img src={user.avatar} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <UserCircle size={30} />
                  )}
                </span>
                <div>
                  <strong>{user.name || user.email}</strong>
                  <span>{user.email}</span>
                </div>
                <span className={`badge ${user.isPro ? "success" : ""}`}>
                  {user.isPro ? "PRO" : "FREE"}
                </span>
              </div>
              <div className="accountStatusGrid">
                <div className="accountStatusRow">
                  <Wallet size={16} />
                  <span>{language === "vi" ? "Số dư" : "Balance"}</span>
                  <strong><CoinAmount value={user.credit} /></strong>
                </div>
                <div className="accountStatusRow">
                  <CalendarClock size={16} />
                  <span>{language === "vi" ? "Hạn Pro" : "Pro expires"}</span>
                  <strong>{formatProUntil(user, language)}</strong>
                </div>
                <div className="accountStatusRow">
                  <Download size={16} />
                  <span>{language === "vi" ? "Tải hôm nay" : "Downloads today"}</span>
                  <strong>{downloadQuotaText(user, language)}</strong>
                  {downloadQuotaHint(user, language) && <small>{downloadQuotaHint(user, language)}</small>}
                </div>
              </div>
              <div className="accountMenuActions">
                {user.role === "admin" && (
                  <button className="adminLink" onClick={() => goPath("/admin")}>
                    {t.admin}
                  </button>
                )}
                <button className="iconButton" onClick={logout} title={t.logout}>
                  <LogOut size={17} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="account">
            <a className="headerLoginButton" href={googleHref()}>
              <Chrome size={15} />
              {t.googleLogin}
            </a>
            <LanguageToggle language={language} onLanguageChange={onLanguageChange} />
            <ThemeToggle theme={theme} onThemeToggle={onThemeToggle} />
          </div>
        )}
      </div>
    </header>
    {fullscreenNotification && (
      <div className="fullscreenNoticeOverlay" role="dialog" aria-modal="true" aria-labelledby="fullscreenNoticeTitle">
        <div className="fullscreenNotice">
          <button
            type="button"
            className="fullscreenNoticeClose"
            onClick={() => closeFullscreenNotification(fullscreenNotification._id)}
            aria-label="Close"
          >
            <X size={20} />
          </button>
          {fullscreenNotification.imageUrl && (
            <div className="fullscreenNoticeImage">
              <img src={fullscreenNotification.imageUrl} alt={fullscreenNotification.title} loading="eager" referrerPolicy="no-referrer" />
            </div>
          )}
          <div className="fullscreenNoticeContent">
            <span>
              {fullscreenNotification.expiresAt
                ? `${t.until} ${new Date(fullscreenNotification.expiresAt).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}`
                : t.notifications}
            </span>
            <h2 id="fullscreenNoticeTitle">{fullscreenNotification.title}</h2>
            <p>{fullscreenNotification.body}</p>
            <div className="fullscreenNoticeActions">
              {fullscreenNotification.actionUrl && (
                <button type="button" className="primaryButton" onClick={() => goFullscreenAction(fullscreenNotification)}>
                  {fullscreenNotification.actionLabel || t.viewNow}
                </button>
              )}
              <button type="button" className="smallButton" onClick={() => closeFullscreenNotification(fullscreenNotification._id)}>
                {t.close}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
