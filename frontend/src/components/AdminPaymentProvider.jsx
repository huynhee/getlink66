import React, { useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { api } from "../api.js";
import "./admin-payment-provider.css";

export default function AdminPaymentProvider({ language }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState("env");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const vi = language === "vi";
  const name = (provider) => provider === "timo" ? "Timo / VietQR" : "SePay";

  function accept(result) {
    setData(result);
    setSelected(result.source === "database" ? result.provider : "env");
  }

  useEffect(() => {
    let active = true;
    api("/api/admin/payments/provider").then((result) => { if (active) accept(result); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);

  async function submit(save) {
    setBusy(true); setError(""); setSaved(false);
    try {
      accept(await api("/api/admin/payments/provider", save ? { method: "PATCH", body: JSON.stringify({ provider: selected }) } : {}));
      setSaved(save);
    } catch (err) { setError(err.data?.issues?.join("; ") || err.message); }
    finally { setBusy(false); }
  }

  const candidate = selected === "env" ? data?.envProvider : selected;
  const ready = data?.options?.some((option) => option.provider === candidate && option.enabled);
  const current = data?.source === "database" ? data.provider : "env";
  return <section className="adminPaymentRouting" aria-labelledby="admin-payment-routing-title">
    <h3 id="admin-payment-routing-title">{vi ? "Cổng thanh toán VND" : "VND payment provider"}</h3>
    <div className="adminPaymentRoutingControls">
      <label>{vi ? "Nhận đơn mới qua" : "New orders via"}
        <select value={selected} disabled={busy || !data} onChange={(event) => { setSelected(event.target.value); setSaved(false); }}>
          <option value="env">{vi ? "Theo cấu hình VPS" : "VPS default"}{data ? ` (${name(data.envProvider)})` : ""}</option>
          {data?.options?.map((option) => <option key={option.provider} value={option.provider} disabled={!option.enabled}>
            {name(option.provider)}{!option.enabled ? vi ? " · Chưa sẵn sàng" : " · Not ready" : ""}
          </option>)}
        </select>
      </label>
      <button type="button" className="googleButton" disabled={busy || !ready || selected === current} onClick={() => submit(true)}><Save size={16} />{vi ? "Lưu" : "Save"}</button>
      <button type="button" className="googleButton" disabled={busy} onClick={() => submit(false)} title={vi ? "Kiểm tra cấu hình" : "Refresh configuration"} aria-label={vi ? "Kiểm tra cấu hình" : "Refresh configuration"}><RefreshCw size={16} /></button>
    </div>
    {data && <p>{vi ? "Đang dùng: " : "Active: "}<strong>{name(data.provider)}</strong> · EN: PayPal / USD</p>}
    <p className="muted">{vi ? "Chỉ áp dụng cho đơn VND mới. Đơn đã tạo giữ nguyên cổng thanh toán." : "Applies to new VND orders only. Existing orders keep their original provider."}</p>
    {data?.options?.filter((option) => !option.enabled).map((option) => <p className="muted" key={option.provider}>{name(option.provider)}: {option.issues.join("; ")}</p>)}
    {saved && <p className="success" role="status">{vi ? "Đã đổi cổng nhận đơn mới." : "New-order payment provider updated."}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
