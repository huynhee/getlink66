import React, { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Copy, Loader2, RefreshCw, X } from "lucide-react";
import { api } from "../api.js";
import { formatPaymentMoney } from "../utils/paymentPresentation.js";
import "./bank-transfer.css";

export default function BankTransferCheckout({ request, language, onClose, onPaid }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const paid = useRef(false);
  const paidCallback = useRef(onPaid);
  const refresh = useRef(null);
  const dialog = useRef(null);
  const closeCallback = useRef(onClose);
  paidCallback.current = onPaid;
  closeCallback.current = onClose;
  const vi = language === "vi";

  useEffect(() => {
    let active = true;
    let fetching = false;
    paid.current = false;
    async function load() {
      if (fetching || paid.current) return;
      fetching = true;
      setBusy(true);
      try {
        const result = await api(`/api/payments/bank/${request.kind}/${request.id}`);
        if (!active) return;
        setData(result);
        setError("");
        if (result.order.status === "approved" && !paid.current) {
          paid.current = true;
          await paidCallback.current?.(request);
        }
      } catch (err) { if (active) { paid.current = false; setError(err.message); } }
      finally { fetching = false; if (active) setBusy(false); }
    }
    refresh.current = load;
    load();
    const timer = window.setInterval(load, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [request]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    const focused = document.activeElement;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector("button")?.focus();
    function keydown(event) {
      if (event.key === "Escape") closeCallback.current?.();
      if (event.key !== "Tab") return;
      const buttons = [...(dialog.current?.querySelectorAll("button:not(:disabled), a[href], input:not(:disabled), [tabindex='0']") || [])];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", keydown); focused?.focus?.(); };
  }, []);

  async function copy(value, field) {
    try { await navigator.clipboard.writeText(String(value)); setCopied(field); }
    catch { setError(vi ? "Không thể sao chép. Vui lòng sao chép thủ công." : "Could not copy. Please copy the value manually."); }
  }

  const order = data?.order;
  const payment = data?.payment;
  const pending = order?.status === "pending";
  const expired = order?.expiresAt && new Date(order.expiresAt).getTime() < Date.now();
  const rows = payment ? [
    ["bank", vi ? "Ngân hàng" : "Bank", payment.bankName],
    ["account", vi ? "Số tài khoản" : "Account number", payment.accountNo],
    ["name", vi ? "Chủ tài khoản" : "Account holder", payment.accountName],
    ["amount", vi ? "Số tiền" : "Amount", formatPaymentMoney(payment.amount, "VND", vi ? "vi-VN" : "en-US"), payment.amount],
    ["code", vi ? "Nội dung chuyển khoản" : "Transfer description", payment.paymentCode],
  ] : [];

  return <div className="bankTransferBackdrop">
    <section ref={dialog} className="bankTransferDialog" role="dialog" aria-modal="true" aria-labelledby="bank-transfer-title">
      <header><h2 id="bank-transfer-title">{vi ? "Thanh toán" : "Payment"}</h2>
        <button type="button" className="bankTransferIcon" onClick={onClose} title={vi ? "Đóng" : "Close"} aria-label={vi ? "Đóng" : "Close"}><X size={20} /></button></header>
      {!data && !error && <p role="status"><Loader2 size={18} /> {vi ? "Đang tải thông tin thanh toán..." : "Loading payment details..."}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {pending && payment && <>
        <div className="bankTransferBody">
          <div className="bankTransferQr"><img src={payment.qrUrl} alt={vi ? "Mã VietQR thanh toán đơn hàng" : "Order payment VietQR"} width="280" height="340" />
            <span>VietQR · Timo by BVBank</span></div>
          <dl>{rows.map(([key, label, value, copyValue]) => <div key={key} className={key === "code" ? "bankTransferCode" : ""}>
            <dt>{label}</dt><dd>{value}</dd>{key !== "bank" && <button type="button" className="bankTransferIcon" onClick={() => copy(copyValue ?? value, key)}
              title={vi ? `Sao chép ${label.toLowerCase()}` : `Copy ${label.toLowerCase()}`} aria-label={vi ? `Sao chép ${label.toLowerCase()}` : `Copy ${label.toLowerCase()}`}>
              {copied === key ? <Check size={16} /> : <Copy size={16} />}</button>}
          </div>)}</dl>
        </div>
        <p className="bankTransferNotice">{vi ? "Chuyển đúng số tiền và giữ nguyên nội dung. Đơn được xác nhận sau khi nhận thông báo từ ngân hàng." : "Transfer the exact amount with the unchanged description. Confirmation follows the bank notification."}</p>
        {expired && <p className="error" role="status">{vi ? "Đơn đã quá thời hạn thanh toán. Nếu đã chuyển tiền, không thanh toán lại; liên hệ hỗ trợ để đối soát." : "This payment has expired. If you already transferred, do not pay again; contact support for reconciliation."}</p>}
        <footer><span role="status"><Loader2 size={16} />{vi ? "Chờ xác nhận thanh toán" : "Awaiting payment confirmation"}</span>
          <button type="button" className="googleButton" disabled={busy} onClick={() => refresh.current?.()}><RefreshCw size={16} />{vi ? "Kiểm tra" : "Check"}</button></footer>
      </>}
      {order?.status === "approved" && <p className="success" role="status"><CheckCircle2 size={20} />{vi ? "Thanh toán thành công." : "Payment confirmed."}</p>}
      {order?.status === "rejected" && <p role="status">{vi ? "Đơn đã hủy hoặc hết hạn. Nếu đã chuyển tiền, không thanh toán lại; liên hệ hỗ trợ để đối soát." : "This order was canceled or expired. If you already paid, do not pay again; contact support for reconciliation."}</p>}
    </section>
  </div>;
}
