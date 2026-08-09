import React, { useEffect, useRef, useState } from "react";
import { Bell, CalendarClock, Chrome, Download, History, LogOut, Menu, Moon, Sun, UserCircle, UserPlus, Wallet, X } from "lucide-react";
import { API_URL, api } from "../api.js";
import CoinAmount from "./CoinAmount.jsx";
import { translations } from "../i18n.js";
import { setFaviconNotificationCount } from "../utils/faviconProgress.js";

function LanguageToggle({ language, onLanguageChange }) {
  const nextLanguage = language === "vi" ? "en" : "vi";
  const label = language === "vi" ? "Switch to English" : "Chuyển sang tiếng Việt";

  return (
    <div className="languageToggle languageToggleSingle">
      <button
        type="button"
        className="active"
        onClick={() => onLanguageChange?.(nextLanguage)}
        title={label}
        aria-label={label}
      >
        {language.toUpperCase()}
      </button>
    </div>
  );
}

function ThemeToggle({ theme = "dark", language = "vi", onThemeToggle }) {
  const isLight = theme === "light";
  const label = language === "vi"
    ? (isLight ? "Chuyển sang giao diện tối" : "Chuyển sang giao diện sáng")
    : (isLight ? "Switch to dark mode" : "Switch to light mode");
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

function PluginDownloadButton({ language = "vi" }) {
  const downloadUrl = String(import.meta.env.VITE_3DSMAX_PLUGIN_DOWNLOAD_URL || "").trim();
  const availableLabel = language === "vi" ? "Tải plugin 3ds Max" : "Download 3ds Max plugin";
  const unavailableLabel = language === "vi"
    ? "Plugin 3ds Max chưa được phát hành"
    : "The 3ds Max plugin is not released yet";

  if (!downloadUrl) {
    return (
      <button
        type="button"
        className="pluginDownloadButton unavailable"
        title={unavailableLabel}
        aria-label={unavailableLabel}
      disabled
      >
        <Download size={16} />
        <span>{language === "vi" ? "Tải plugin" : "Download plugin"}</span>
      </button>
    );
  }

  return (
    <a
      className="pluginDownloadButton"
      href={downloadUrl}
      title={availableLabel}
      aria-label={availableLabel}
      download
    >
      <Download size={16} />
      <span>{language === "vi" ? "Tải plugin" : "Download plugin"}</span>
    </a>
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
  const accountRef = useRef(null);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [sessionHiddenFullscreenIds, setSessionHiddenFullscreenIds] = useState(() => new Set());
  const userId = user?._id;
  const unreadCount = notifications.filter(
    (item) => item.displayType !== "fullscreen" && !item.isRead
  ).length;
  const fullscreenNotification = notifications.find(
    (item) => item.displayType === "fullscreen" && !sessionHiddenFullscreenIds.has(item._id)
  );

  useEffect(() => {
    let cancelled = false;
    async function loadNotifications() {
      if (!userId) {
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
    const timer = userId ? window.setInterval(loadNotifications, 60_000) : null;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [userId]);

  useEffect(() => {
    setFaviconNotificationCount(unreadCount);
  }, [unreadCount]);

  useEffect(() => {
    if (!accountOpen) return undefined;

    function closeAccountOnOutsidePointer(event) {
      if (accountRef.current && !accountRef.current.contains(event.target)) {
        setAccountOpen(false);
      }
    }

    function closeAccountOnEscape(event) {
      if (event.key === "Escape") setAccountOpen(false);
    }

    document.addEventListener("pointerdown", closeAccountOnOutsidePointer);
    document.addEventListener("keydown", closeAccountOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeAccountOnOutsidePointer);
      document.removeEventListener("keydown", closeAccountOnEscape);
    };
  }, [accountOpen]);

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
    ["scenes", "Scenes"],
    ["getlink", t.getlink],
    ["topup", language === "vi" ? "Gói nạp" : "Top-up"],
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
              <PluginDownloadButton language={language} />
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
                      onClick={() => goNotificationAction(item)}
                    >
                      <b>{item.title}</b>
                      <span>{item.body}</span>
                      <time>{new Date(item.createdAt).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}</time>
                    </button>
                  ))}
                  {!notifications.length && <p>{t.noNotifications}</p>}
                </div>
              </div>
              <ThemeToggle theme={theme} language={language} onThemeToggle={onThemeToggle} />
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
              <div ref={accountRef} className="accountProfile">
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
                  <nav
                    className="accountMenuNavigation"
                    aria-label={language === "vi" ? "Menu tài khoản" : "Account menu"}
                  >
                    <button
                      type="button"
                      className={page === "history" ? "active" : ""}
                      onClick={() => goPage("history")}
                      aria-current={page === "history" ? "page" : undefined}
                    >
                      <History size={16} />
                      <span>{t.history}</span>
                    </button>
                    <button
                      type="button"
                      className={page === "invite" ? "active" : ""}
                      onClick={() => goPage("invite")}
                      aria-current={page === "invite" ? "page" : undefined}
                    >
                      <UserPlus size={16} />
                      <span>{language === "vi" ? "Giới thiệu" : "Invite friends"}</span>
                    </button>
                  </nav>
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
            </div>
          ) : (
            <div className="account">
              <PluginDownloadButton language={language} />
              <a className="headerLoginButton" href={googleHref()}>
                <Chrome size={15} />
                {t.googleLogin}
              </a>
              <ThemeToggle theme={theme} language={language} onThemeToggle={onThemeToggle} />
              <LanguageToggle language={language} onLanguageChange={onLanguageChange} />
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
