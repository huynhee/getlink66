import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, Laptop, Loader2, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { api } from "../api.js";

let turnstileLoader;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileLoader) return turnstileLoader;
  turnstileLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => window.turnstile
      ? resolve(window.turnstile)
      : reject(new Error("Turnstile did not initialize."));
    script.onerror = () => reject(new Error("Cannot load Turnstile."));
    document.head.appendChild(script);
  });
  return turnstileLoader;
}

function humanDate(value, language) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function SessionList({ language, sessions, onRevoke }) {
  if (!sessions.length) {
    return <p className="muted">{language === "vi" ? "Chưa có thiết bị plugin đang hoạt động." : "No active plugin devices."}</p>;
  }
  return (
    <div className="pluginSessionList">
      {sessions.map((session) => (
        <article className="panel pluginSessionCard" key={session.id}>
          <Laptop size={22} aria-hidden="true" />
          <div>
            <strong>{session.deviceName}</strong>
            <p className="muted">
              3ds Max {session.maxVersion} · Plugin {session.pluginVersion}
            </p>
            <small className="muted">
              {language === "vi" ? "Dùng gần nhất" : "Last used"}: {humanDate(session.lastUsedAt, language)}
            </small>
          </div>
          <button
            type="button"
            className="smallButton dangerButton"
            onClick={() => onRevoke(session.id)}
          >
            <Trash2 size={16} />
            {language === "vi" ? "Thu hồi" : "Revoke"}
          </button>
        </article>
      ))}
    </div>
  );
}

function DeviceActivation({ language, code, appState, user, onChanged }) {
  const [device, setDevice] = useState(null);
  const [loading, setLoading] = useState(Boolean(code));
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [callbackUri, setCallbackUri] = useState("");

  useEffect(() => {
    if (!code) {
      setLoading(false);
      return;
    }
    api(`/api/plugin-activation/device/${encodeURIComponent(code)}`)
      .then(setDevice)
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [code]);

  async function decide(action) {
    setWorking(true);
    setError("");
    try {
      const result = await api(`/api/plugin-activation/device/${encodeURIComponent(code)}/${action}`, {
        method: "POST",
        body: JSON.stringify({ appState }),
      });
      setDevice((current) => ({ ...current, status: action === "approve" ? "approved" : "denied" }));
      setMessage(action === "approve"
        ? (language === "vi" ? "Đã kết nối thiết bị. Có thể quay lại 3ds Max." : "Device connected. You can return to 3ds Max.")
        : (language === "vi" ? "Đã từ chối thiết bị." : "Device denied."));
      onChanged?.();
      if (result.callbackUri) {
        setCallbackUri(result.callbackUri);
        window.location.assign(result.callbackUri);
      }
    } catch (reason) {
      setError(reason.message);
    } finally {
      setWorking(false);
    }
  }

  if (!code) {
    return <p className="error">{language === "vi" ? "Thiếu mã thiết bị." : "Device code is missing."}</p>;
  }
  if (loading) return <p><Loader2 className="spin" size={18} /> Loading…</p>;
  if (error) return <p className="error">{error}</p>;
  if (!device) return null;

  return (
    <section className="panel pluginActivationCard">
      <div className="pluginActivationIcon"><Laptop size={30} /></div>
      <div>
        <p className="eyebrow">3DiPL Asset Manager</p>
        <h2>{device.deviceName}</h2>
        <p className="muted">3ds Max {device.maxVersion} · Plugin {device.pluginVersion}</p>
        {user && (
          <p className="muted">
            {language === "vi" ? "Tài khoản Google" : "Google account"}: <strong>{user.name || user.email}</strong>
          </p>
        )}
        <p><strong>{device.userCode}</strong></p>
      </div>
      {device.status === "pending" ? (
        <div className="pluginActivationActions">
          <button type="button" disabled={working} onClick={() => decide("approve")}>
            <CheckCircle2 size={17} /> {language === "vi" ? "Cho phép" : "Approve"}
          </button>
          <button type="button" className="secondaryButton" disabled={working} onClick={() => decide("deny")}>
            <XCircle size={17} /> {language === "vi" ? "Từ chối" : "Deny"}
          </button>
        </div>
      ) : (
        <p className="muted">{message || device.status}</p>
      )}
      {message && <p className="success">{message}</p>}
      {callbackUri && (
        <a className="smallButton" href={callbackUri}>
          {language === "vi" ? "Mở lại ứng dụng 3DiPL" : "Open 3DiPL app again"}
        </a>
      )}
    </section>
  );
}

function ChallengeApproval({ language, code }) {
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const [challenge, setChallenge] = useState(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (!code) return;
    api(`/api/plugin-activation/challenge/${encodeURIComponent(code)}`)
      .then(setChallenge)
      .catch((reason) => setError(reason.message));
  }, [code]);

  useEffect(() => {
    if (!challenge?.verification?.enabled || !containerRef.current) return undefined;
    let active = true;
    loadTurnstile().then((turnstile) => {
      if (!active || !containerRef.current) return;
      widgetRef.current = turnstile.render(containerRef.current, {
        sitekey: challenge.verification.siteKey,
        action: challenge.verification.action || "marketplace_download",
        cData: String(code).slice(0, 255),
        theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
        callback: setToken,
        "expired-callback": () => setToken(""),
      });
    }).catch((reason) => setError(reason.message));
    return () => {
      active = false;
      if (widgetRef.current !== null && window.turnstile) window.turnstile.remove(widgetRef.current);
    };
  }, [challenge, code]);

  async function approve() {
    setError("");
    try {
      await api(`/api/plugin-activation/challenge/${encodeURIComponent(code)}/approve`, {
        method: "POST",
        body: JSON.stringify({ turnstileToken: token }),
      });
      setApproved(true);
    } catch (reason) {
      setError(reason.message);
    }
  }

  if (!code) return <p className="error">{language === "vi" ? "Thiếu mã xác minh." : "Challenge code is missing."}</p>;
  if (error) return <p className="error">{error}</p>;
  if (!challenge) return <p><Loader2 className="spin" size={18} /> Loading…</p>;
  if (approved || challenge.status === "approved") {
    return (
      <section className="panel pluginActivationCard">
        <CheckCircle2 size={34} />
        <h2>{language === "vi" ? "Đã xác minh" : "Approved"}</h2>
        <p>{language === "vi" ? "Quay lại 3ds Max để tiếp tục tải asset." : "Return to 3ds Max to continue the download."}</p>
      </section>
    );
  }
  return (
    <section className="panel pluginActivationCard">
      <ShieldCheck size={34} />
      <h2>{language === "vi" ? "Xác minh lượt tải plugin" : "Verify plugin download"}</h2>
      <p className="muted">Asset {challenge.assetId}</p>
      {challenge.verification?.enabled && <div ref={containerRef} />}
      <button
        type="button"
        onClick={approve}
        disabled={challenge.verification?.enabled && !token}
      >
        {language === "vi" ? "Xác nhận" : "Approve"}
      </button>
    </section>
  );
}

export default function PluginAccess({ language = "vi", mode = "activate", user = null }) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code") || "";
  const appState = params.get("state") || "";
  const [sessions, setSessions] = useState([]);
  const [sessionError, setSessionError] = useState("");

  async function loadSessions() {
    try {
      const data = await api("/api/plugin-activation/sessions");
      setSessions(data.sessions || []);
      setSessionError("");
    } catch (reason) {
      setSessionError(reason.message);
    }
  }

  useEffect(() => {
    if (mode !== "challenge") loadSessions();
  }, [mode]);

  async function revoke(id) {
    try {
      await api(`/api/plugin-activation/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await loadSessions();
    } catch (reason) {
      setSessionError(reason.message);
    }
  }

  return (
    <div className="pluginAccessPage">
      {mode === "challenge" ? (
        <ChallengeApproval language={language} code={code} />
      ) : (
        <>
          {mode === "activate" && (
            <DeviceActivation
              language={language}
              code={code}
              appState={appState}
              user={user}
              onChanged={loadSessions}
            />
          )}
          <section className="pluginSessionsSection">
            <h2>{language === "vi" ? "Thiết bị 3DiPL Plugin" : "3DiPL Plugin devices"}</h2>
            <p className="muted">
              {language === "vi"
                ? "Thu hồi những máy bạn không còn sử dụng."
                : "Revoke devices you no longer use."}
            </p>
            {sessionError && <p className="error">{sessionError}</p>}
            <SessionList language={language} sessions={sessions} onRevoke={revoke} />
          </section>
        </>
      )}
    </div>
  );
}
