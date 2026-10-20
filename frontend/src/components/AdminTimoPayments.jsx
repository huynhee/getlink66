import React, { useEffect, useState } from "react";
import { ChevronDown, RefreshCw, RotateCcw } from "lucide-react";
import { api } from "../api.js";
import { formatPaymentMoney } from "../utils/paymentPresentation.js";
import "./admin-timo-payments.css";

export default function AdminTimoPayments({ language }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const vi = language === "vi";
  const date = (value) => value ? new Date(value).toLocaleString(vi ? "vi-VN" : "en-US") : "-";

  useEffect(() => {
    let active = true;
    api("/api/admin/payments/timo").then((result) => { if (active) setData(result); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);

  async function action(path) {
    setBusy(true);
    setError("");
    try {
      if (path) await api(path, { method: "POST", body: "{}" });
      setData(await api("/api/admin/payments/timo"));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (!data && !error) return null;
  if (data && !data.workerEnabled && data.provider !== "timo" && !data.events?.length) return null;
  const states = vi ? { pending: "Chờ đọc", verified: "Đã xác thực", applied: "Đã duyệt", review: "Cần đối soát", ignored: "Bỏ qua" }
    : { pending: "Pending", verified: "Verified", applied: "Settled", review: "Needs review", ignored: "Ignored" };
  return <details className="adminTimoPayments">
    <summary><h3>{vi ? "Đối soát Timo / Gmail" : "Timo / Gmail reconciliation"}<ChevronDown size={18} aria-hidden="true" /></h3></summary>
    <div className="stack adminTimoPaymentsContent">
    <div className="adminSectionHeader">
      <div className="adminTimoPaymentsAccount">
        <p>{data?.accountName} · {data?.accountNo} · {data?.mailbox}</p>
        <p>{vi ? "Đọc mail thành công lần cuối: " : "Last successful mailbox poll: "}{date(data?.state?.lastSuccessAt)}</p>
      </div>
      <button type="button" className="googleButton" disabled={busy} onClick={() => action(data?.workerEnabled ? "/api/admin/payments/timo/reconcile" : null)}>
        <RefreshCw size={16} />{vi ? "Đối soát ngay" : "Reconcile now"}</button></div>
    {data?.state?.lastError && <p className="error">{data.state.lastError}</p>}
    {data?.issues?.map((issue) => <p key={issue} className="error">{issue}</p>)}
    {error && <p role="alert" className="error">{error}</p>}
    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead><tr>{[vi ? "Nhận thư" : "Received", vi ? "Mã đơn" : "Order code", vi ? "Số tiền" : "Amount", vi ? "Trạng thái" : "Status", vi ? "Chi tiết" : "Details", ""].map((label, i) => <th key={i} style={{ textAlign: "left", padding: 8 }}>{label}</th>)}</tr></thead>
      <tbody>{data?.events?.map((event) => <tr key={event._id}>
        <td style={{ padding: 8 }}>{date(event.receivedAt || event.createdAt)}</td><td>{event.paymentCode || "-"}</td>
        <td>{event.amount ? formatPaymentMoney(event.amount, "VND", vi ? "vi-VN" : "en-US") : "-"}</td><td>{states[event.state] || event.state}</td>
        <td>{event.reason || "-"}</td><td>{["review", "pending", "verified"].includes(event.state) && <button type="button" className="googleButton" disabled={busy}
          title={vi ? "Xác thực và đối soát lại" : "Verify and reconcile again"} aria-label={vi ? "Xác thực và đối soát lại" : "Verify and reconcile again"}
          onClick={() => action(`/api/admin/payments/timo/events/${encodeURIComponent(event._id)}/retry`)}><RotateCcw size={16} /></button>}</td>
      </tr>)}</tbody>
    </table></div>
    </div>
  </details>;
}
