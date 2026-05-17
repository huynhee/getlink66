import React, { useEffect, useState } from "react";
import { Check, Copy, Gift, CreditCard, QrCode } from "lucide-react";
import { api } from "../api.js";
import { translations } from "../i18n.js";

export default function Topup({ user, onUserChange, language = "vi" }) {
  const t = translations[language] || translations.vi;
  const [packages, setPackages] = useState([]);
  const [voucher, setVoucher] = useState("");
  const [appliedVoucher, setAppliedVoucher] = useState(null);
  const [payment, setPayment] = useState(null);
  const [lastPaidPayment, setLastPaidPayment] = useState(null);
  const [copied, setCopied] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/topup/packages").then((data) => setPackages(data.packages));
  }, []);

  useEffect(() => {
    if (!payment || payment.status !== "pending") return undefined;

    const timer = window.setInterval(async () => {
      try {
        const history = await api("/api/topup/history");
        const latest = (history.history || []).find((item) => item._id === payment._id);
        if (latest?.status === "approved") {
          const creditData = await api("/api/credit");
          setLastPaidPayment(latest);
          setPayment(null);
          onUserChange({ ...user, credit: creditData.credit });
          setMessage(`Nạp VietQR thành công: +${latest.credit} credit. Số dư hiện tại: ${creditData.credit} credit`);
          window.clearInterval(timer);
        }
      } catch {
        /* keep polling */
      }
    }, 5000);

    return () => window.clearInterval(timer);
  }, [payment, onUserChange, user]);

  function finalPrice(item) {
    const priceAfterSale = Math.round(Number(item.price || 0) * (100 - Number(item.salePercent || 0)) / 100);
    if (Number(appliedVoucher?.discountPercent || 0) > 0) {
      return Math.max(0, Math.round(priceAfterSale * (100 - Number(appliedVoucher.discountPercent)) / 100));
    }
    return priceAfterSale;
  }

  function priceBeforeVoucher(item) {
    return Math.round(Number(item.price || 0) * (100 - Number(item.salePercent || 0)) / 100);
  }

  function hasSale(item) {
    return Number(item.salePercent || 0) > 0;
  }

  function finalCredit(item) {
    return Number(item.credit || 0) + Number(appliedVoucher?.creditBonus || 0);
  }

  async function topup(item) {
    try {
      setMessage("");
      setError("");
      setPayment(null);
      setLastPaidPayment(null);
      const data = await api("/api/topup", {
        method: "POST",
        body: JSON.stringify({
          packageId: item._id,
          type: "vietqr",
          voucherCode: appliedVoucher?.code || undefined
        })
      });
      setPayment(data.topup);
      setMessage(t.qrCreated);
    } catch (err) {
      setError(err.message);
    }
  }

  async function copyText(value, key) {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      setCopied(key);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      /* fallback: do nothing */
    }
  }

  async function applyVoucher(event) {
    event.preventDefault();
    try {
      setMessage("");
      setError("");
      const data = await api("/api/voucher/apply", {
        method: "POST",
        body: JSON.stringify({ code: voucher })
      });
      setAppliedVoucher(data.voucher || null);
      setPayment(null);
      setLastPaidPayment(null);
      setVoucher("");
      setMessage(data.message || `Voucher đã được áp dụng. Chọn lại gói nạp để tạo QR với giá mới.`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2><QrCode size={20} /> {t.topupMoney}</h2>
          <span className="badge success">{t.automatic}</span>
        </div>
        <p className="muted">{t.topupIntro}</p>
        <p className="muted">{t.topupVoucherHelp}</p>
        <div className="packageGrid">
          {packages.map((item) => (
            <button className="package" key={item._id || item.price} onClick={() => topup(item)} style={{ alignItems: "stretch", textAlign: "left" }}>
              <CreditCard size={20} />
              {item.badge && <span className="badge success">{item.badge}</span>}
              <h3>{item.name || "GÓI CREDIT"}</h3>
              <div className="priceBlock compact">
                {hasSale(item) && (
                  <div className="priceOriginal">
                    {Number(item.price).toLocaleString("vi-VN")}<span>đ</span>
                  </div>
                )}
                <strong>{finalPrice(item).toLocaleString("vi-VN")}đ</strong>
              </div>
              {Number(appliedVoucher?.discountPercent || 0) > 0 && (
                <span>
                  Sau voucher {appliedVoucher.code}: giảm {appliedVoucher.discountPercent}% từ {priceBeforeVoucher(item).toLocaleString("vi-VN")}đ
                </span>
              )}
              {hasSale(item) && (
                <span className="saleOnly" data-sale={item.salePercent}>Sale {item.salePercent}% từ {Number(item.price).toLocaleString("vi-VN")}đ</span>
              )}
              <strong>{finalCredit(item)} credit</strong>
              {Number(appliedVoucher?.creditBonus || 0) > 0 && (
                <span>Bonus voucher {appliedVoucher.code}: +{appliedVoucher.creditBonus} credit</span>
              )}
              <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                {((item.features && item.features.length > 0)
                  ? item.features
                  : [`${item.credit} lượt tải model`, "Lưu lịch sử tải", "Hỗ trợ cơ bản"]
                ).map((feature, index) => (
                  <li key={index}>{feature}</li>
                ))}
              </ul>
            </button>
          ))}
        </div>
        {message && <p className="success" style={{ marginTop: 14 }}>{message}</p>}
        {error && <p className="error" style={{ marginTop: 14 }}>{error}</p>}
        {lastPaidPayment && (
          <div className="result" style={{ marginTop: 16, borderColor: "rgba(0, 255, 136, 0.45)" }}>
            <span>{t.paymentDone}</span>
            <strong>+{lastPaidPayment.credit} credit</strong>
            <p>
              Mã nạp {lastPaidPayment.paymentCode} đã được xác nhận. Bạn có thể chọn gói bên trên để tạo lượt nạp mới.
            </p>
          </div>
        )}
        {payment && (
          <div className="result" style={{ marginTop: 16 }}>
            <span>{t.paymentInfo}</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18, alignItems: "start" }}>
              <img
                src={payment.qrUrl}
                alt="VietQR thanh toán"
                style={{ width: "100%", borderRadius: 8, background: "#fff", padding: 8 }}
              />
              <div className="table">
                <div className="tableRow">
                  <span>{t.amount}</span>
                  <strong>{Number(payment.amount).toLocaleString("vi-VN")}đ</strong>
                  <button className="smallButton" type="button" onClick={() => copyText(payment.amount, "amount")}>
                    {copied === "amount" ? <Check size={14} /> : <Copy size={14} />}
                    {t.copy}
                  </button>
                </div>
                {Number(payment.discountAmount || 0) > 0 && (
                  <div className="tableRow">
                    <span>Voucher</span>
                    <strong>{payment.voucherCode}</strong>
                    <span>-{Number(payment.discountAmount).toLocaleString("vi-VN")}đ</span>
                  </div>
                )}
                {payment.voucherCode && Number(payment.discountAmount || 0) <= 0 && (
                  <div className="tableRow">
                    <span>Voucher</span>
                    <strong>{payment.voucherCode}</strong>
                    <span>+{Number(payment.voucherCreditBonus || 0)} credit</span>
                  </div>
                )}
                <div className="tableRow">
                  <span>{t.transferContent}</span>
                  <strong>{payment.paymentCode}</strong>
                  <button className="smallButton" type="button" onClick={() => copyText(payment.paymentCode, "code")}>
                    {copied === "code" ? <Check size={14} /> : <Copy size={14} />}
                    {t.copy}
                  </button>
                </div>
                <div className="tableRow">
                  <span>{t.account}</span>
                  <strong>{payment.accountNo}</strong>
                  <span>{payment.accountName}</span>
                </div>
                <div className="tableRow">
                  <span>{t.bank}</span>
                  <strong>{payment.bankId}</strong>
                  <span>{t.status}: {payment.status === "approved" ? t.credited : t.waitingPayment}</span>
                </div>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
              {t.transferNote}
            </p>
          </div>
        )}
        {appliedVoucher && (
          <div className="result">
            <span>{t.voucherInfo}</span>
            <strong>{appliedVoucher.code}</strong>
            {appliedVoucher.description && <p>{appliedVoucher.description}</p>}
            <p>
              {appliedVoucher.discountPercent > 0
                ? `Giảm ${appliedVoucher.discountPercent}% cho gói nạp. Giá QR sẽ giảm khi bạn chọn gói.`
                : `Cộng thêm ${appliedVoucher.creditBonus} credit khi nạp thành công.`}
            </p>
          </div>
        )}
      </section>

      <section className="panel">
        <h2><Gift size={20} /> Voucher</h2>
        <form className="inputRow" onSubmit={applyVoucher}>
          <input
            value={voucher}
            onChange={(event) => setVoucher(event.target.value)}
            placeholder={t.voucherPlaceholder}
          />
          <button disabled={!voucher}>
            <Gift size={18} />
            {t.apply}
          </button>
        </form>
      </section>
    </div>
  );
}
