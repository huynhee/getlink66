import React, { useEffect, useRef, useState } from "react";
import { Loader2, Monitor, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import { api } from "../api.js";
import "./admin-3d66-verification.css";

const endpoint = "/api/admin/getlink/verifications";
const post = (session, action, body = {}) => api(`${endpoint}/${session.id}/${action}`, {
  method: "POST", body: JSON.stringify({ ...body, token: session.token }),
});

export default function Admin3D66Verification({ language }) {
  const vi = language === "vi";
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [frame, setFrame] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const live = useRef(null);
  const dialog = useRef(null);
  const mounted = useRef(false);
  const paused = useRef(false);
  const pointer = useRef({ down: false, sequence: 0, queue: [], sending: false });

  useEffect(() => {
    mounted.current = true;
    let timer;
    async function refresh() {
      try {
        const data = await api(endpoint);
        if (mounted.current) setSessions(data.sessions || []);
      } catch (err) { if (mounted.current) setError(err.message); }
      if (mounted.current) timer = setTimeout(refresh, 5000);
    }
    void refresh();
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      const session = live.current;
      live.current = null;
      if (session) void post(session, "release").catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    dialog.current?.showModal();
    let cancelled = false;
    let timer;
    async function refresh() {
      if (cancelled || live.current !== selected) return;
      try {
        if (!paused.current) {
          const data = await post(selected, "frame");
          if (!cancelled && live.current === selected && !paused.current) setFrame(data);
        }
      } catch (err) {
        if (!cancelled && !paused.current) setError(err.message);
        if ([403, 410].includes(err.status)) return;
      }
      if (!cancelled) timer = setTimeout(refresh, 750);
    }
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [selected]);

  async function claim(item) {
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await post({ id: item.id }, "claim");
      const session = { ...data.session, token: data.token };
      if (!mounted.current) { await post(session, "release"); return; }
      live.current = session;
      paused.current = false;
      pointer.current = { down: false, sequence: 0, queue: [], sending: false };
      setFrame(null); setSelected(session);
    } catch (err) { setError(err.message); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function close(cancel = false) {
    const session = live.current;
    if (!session) return;
    paused.current = true;
    setBusy(true); setError("");
    try {
      if (cancel) await api(`${endpoint}/${session.id}`, { method: "DELETE", body: JSON.stringify({ token: session.token }) });
      else await post(session, "release");
    } catch (err) { if (![403, 410].includes(err.status)) setError(err.message); }
    finally {
      live.current = null;
      pointer.current.queue = [];
      pointer.current.down = false;
      setSelected(null); setFrame(null); setDragging(false); setBusy(false);
    }
  }

  async function command(action) {
    const session = live.current;
    if (!session || busy || pointer.current.down || pointer.current.sending) return;
    paused.current = true;
    setBusy(true); setError("");
    try {
      await post(session, action);
      if (action === "complete") {
        live.current = null;
        setSelected(null); setFrame(null);
        setSessions(items => items.filter(item => item.id !== session.id));
        setMessage(vi ? "Đã xác minh và lưu phiên. Có thể thử lại Getlink." : "Session verified and saved. Getlink can now be retried.");
      }
    } catch (err) { setError(err.message); }
    finally { paused.current = false; setBusy(false); }
  }

  async function sendPointer(session, state) {
    if (state.sending) return;
    state.sending = true;
    try {
      while (state.queue.length && live.current === session) {
        const input = state.queue.shift();
        await post(session, "input", { ...input, sequence: state.sequence++ });
        if (input.type === "move") await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (err) {
      state.queue = []; state.down = false;
      if (mounted.current) { setError(err.message); setDragging(false); }
    } finally { state.sending = false; }
  }

  function relay(event, type) {
    if (!event.nativeEvent.isTrusted || !frame || paused.current || busy || !live.current) return;
    const state = pointer.current;
    if (type === "down" && (event.button !== 0 || state.down)) return;
    if (type !== "down" && !state.down) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(frame.viewport.width - 1, (event.clientX - rect.left) * frame.viewport.width / rect.width));
    const y = Math.max(0, Math.min(frame.viewport.height - 1, (event.clientY - rect.top) * frame.viewport.height / rect.height));
    if (type === "down") { event.currentTarget.setPointerCapture(event.pointerId); state.down = true; setDragging(true); }
    if (type === "up") { state.down = false; setDragging(false); }
    const input = { type, x, y };
    if (type === "move" && state.queue.at(-1)?.type === "move") state.queue[state.queue.length - 1] = input;
    else state.queue.push(input);
    void sendPointer(live.current, state);
  }

  return <div className="admin3D66Verification">
    <h3><Monitor size={18} />{vi ? "Phiên Getlink chờ xác minh" : "Getlink verification sessions"}</h3>
    {message && <p className="success" role="status">{message}</p>}
    {!selected && error && <p className="error" role="alert">{error}</p>}
    {!sessions.length && <p className="muted">{vi ? "Không có phiên chờ xác minh." : "No sessions awaiting verification."}</p>}
    {sessions.map(item => <div className="verificationSessionRow" key={item.id}>
      <code>{item.productId}</code>
      <time>{vi ? "Hết hạn" : "Expires"}: {new Date(item.expiresAt).toLocaleTimeString(vi ? "vi-VN" : "en-US")}</time>
      <button type="button" className="smallButton" disabled={busy || Boolean(selected) || item.claimed} onClick={() => claim(item)}>
        <Monitor size={15} />{item.claimed ? (vi ? "Đang được xử lý" : "In use") : (vi ? "Mở phiên" : "Open session")}
      </button>
    </div>)}
    {selected && <dialog ref={dialog} className="verificationDialog" aria-labelledby="verificationTitle"
      onCancel={event => { event.preventDefault(); if (!busy) void close(); }}>
      <header><h3 id="verificationTitle"><ShieldCheck size={18} />{vi ? "Xác minh thủ công" : "Manual verification"}</h3>
        <button type="button" className="iconButton" aria-label={vi ? "Đóng" : "Close"} title={vi ? "Đóng" : "Close"} disabled={busy} onClick={() => close()}><X size={18} /></button></header>
      <div className="verificationSessionInfo"><code>{selected.productId}</code><span>{vi ? "Mua và tải file đang bị chặn" : "Purchases and downloads blocked"}</span></div>
      <div className="verificationViewport">
        {frame?.image && frame.viewport ? <img src={frame.image} width={frame.viewport.width} height={frame.viewport.height}
          alt={vi ? "Trang xác minh Getlink hiện tại" : "Current Getlink verification page"} draggable={false}
          onPointerDown={event => relay(event, "down")} onPointerMove={event => relay(event, "move")}
          onPointerUp={event => relay(event, "up")} onPointerCancel={event => relay(event, "up")} />
          : <div role="status"><Loader2 size={24} className="spin" />{vi ? "Đang mở đúng phiên Getlink..." : "Opening the retained Getlink session..."}</div>}
      </div>
      <div className="verificationFeedback" aria-live="polite">{error ? <p className="error" role="alert">{error}</p> : <span className="muted">{frame?.title || ""}</span>}</div>
      <footer>
        <button type="button" className="smallButton" disabled={busy || dragging} onClick={() => command("reload")}><RefreshCw size={15} />{vi ? "Tải lại trang" : "Reload page"}</button>
        <button type="button" className="primaryButton" disabled={busy || dragging || !frame} onClick={() => command("complete")}>{busy ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />}{vi ? "Kiểm tra và lưu phiên" : "Verify and save session"}</button>
        <button type="button" className="smallButton" disabled={busy || dragging} onClick={() => close(true)}><Trash2 size={15} />{vi ? "Hủy phiên" : "Discard session"}</button>
      </footer>
    </dialog>}
  </div>;
}
