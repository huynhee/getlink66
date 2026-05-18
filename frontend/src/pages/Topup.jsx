import React, { useEffect, useState } from "react";
import { Check, Copy, Gift, CreditCard, QrCode } from "lucide-react";
import { api } from "../api.js";
import { translations } from "../i18n.js";

const CURRENCY = "đ";

function submitPaymentCheckout(payment) {
  if (!payment?.checkoutUrl || !payment?.fields) return false;

  const form = document.createElement("form");
  form.method = "POST";
  form.action = payment.checkoutUrl;
  form.style.display = "none";

  Object.entries(payment.fields).forEach(([name, value]) => {
    if (value === undefined || value === null) return;
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = String(value);
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
  return true;
}

function recentApprovedTopup(history = []) {
  const now = Date.now();
  return history.find((item) => {
    if (item.status !== "approved") return false;
    const createdAt = new Date(item.createdAt || item.paidAt || 0).getTime();
    return Number.isFinite(createdAt) && now - createdAt <= 2 * 60 * 60 * 1000;
  });
}

export default function Topup({ user, onUserChange, language = "vi" }) {
  const t = translations[language] || translations.vi;
  const [packages, setPackages] = useState([]);
  const [voucher, setVoucher] = useState("");
  const [appliedVoucher, setAppliedVoucher] = useState(null);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [payment, setPayment] = useState(null);
  const [lastPaidPayment, setLastPaidPayment] = useState(null);
  const [copied, setCopied] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/topup/packages").then((data) => setPackages(data.packages));
  }, []);

  useEffect(() => {
    const paymentStatus = new URLSearchParams(window.location.search).get("payment");
    if (!paymentStatus) return undefined;

    if (paymentStatus === "error") {
      setError("Thanh toán bị lỗi hoặc bị từ chối.");
      return undefined;
    }
    if (paymentStatus === "cancel") {
      setMessage("Bạn đã huỷ thanh toán.");
      return undefined;
    }

    setMessage("Đang kiểm tra thanh toán...");
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      try {
        const [history, creditData] = await Promise.all([
          api("/api/topup/history"),
          api("/api/credit"),
        ]);
        const latestApproved = recentApprovedTopup(history.history || []);
        if (latestApproved) {
          setLastPaidPayment(latestApproved);
          onUserChange({ ...user, credit: creditData.credit });
          setMessage(`Nạp thành công: +${latestApproved.credit} credit. Số dư hiện tại: ${creditData.credit} credit`);
          window.clearInterval(timer);
        }
      } catch {
        /* keep polling */
      }
      if (attempts >= 12) window.clearInterval(timer);
    }, 3000);

    return () => window.clearInterval(timer);
  }, [onUserChange, user]);

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
          setMessage(`Nạp thành công: +${latest.credit} credit. Số dư hiện tại: ${creditData.credit} credit`);
          window.clearInterval(timer);
        }
      } catch {
        /* keep polling */
      }
    }, 5000);

    return () => window.clearInterval(timer);
  }, [payment, onUserChange, user]);

  function priceBeforeVoucher(item) {
    return Math.round(Number(item.price || 0) * (100 - Number(item.salePercent || 0)) / 100);
  }

  function voucherAppliesToPackage(currentVoucher, item) {
    if (!currentVoucher) return false;
    const packageIds = Array.isArray(currentVoucher.applicablePackageIds)
      ? currentVoucher.applicablePackageIds.map(String)
      : [];
    return packageIds.length === 0 || packageIds.includes(String(item._id));
  }

  function finalPrice(item) {
    if (!voucherAppliesToPackage(appliedVoucher, item)) return priceBeforeVoucher(item);
    const priceAfterSale = priceBeforeVoucher(item);
    if (Number(appliedVoucher?.discountPercent || 0) > 0) {
      return Math.max(0, Math.round(priceAfterSale * (100 - Number(appliedVoucher.discountPercent)) / 100));
    }
    return priceAfterSale;
  }

  function hasSale(item) {
    return Number(item.salePercent || 0) > 0;
  }

  function finalCredit(item) {
    return Number(item.credit || 0) + (voucherAppliesToPackage(appliedVoucher, item) ? Number(appliedVoucher?.creditBonus || 0) : 0);
  }

  const selectedPackage = packages.find((item) => String(item._id) === String(selectedPackageId));

  function selectPackage(item) {
    setSelectedPackageId(item._id);
    setPayment(null);
    setLastPaidPayment(null);
    setMessage("");
    setError("");
  }

  async function topup() {
    if (!selectedPackage) {
      setError("Chọn một gói nạp trước khi thanh toán.");
      return;
    }

    try {
      setMessage("");
      setError("");
      setPayment(null);
      setLastPaidPayment(null);
      const data = await api("/api/topup", {
        method: "POST",
        body: JSON.stringify({
          packageId: selectedPackage._id,
          type: "sepay",
          voucherCode: voucherAppliesToPackage(appliedVoucher, selectedPackage) ? appliedVoucher?.code : undefined,
        }),
      });
      setPayment(data.topup);
      setMessage("Đang chuyển sang cổng thanh toán...");
      if (!submitPaymentCheckout(data.payment)) {
        setMessage("Đã tạo đơn thanh toán. Nếu trình duyệt không tự chuyển, hãy thử lại.");
      }
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
        body: JSON.stringify({ code: voucher }),
      });
      setAppliedVoucher(data.voucher || null);
      setPayment(null);
      setLastPaidPayment(null);
      setVoucher("");
      setMessage(data.message || "Voucher đã được áp dụng. Chọn gói nạp rồi bấm nạp ngay.");
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
            <button
              className={`package ${selectedPackageId === item._id ? "selectedPackage" : ""}`}
              key={item._id || item.price}
              onClick={() => selectPackage(item)}
              style={{ alignItems: "stretch", textAlign: "left" }}
            >
              <CreditCard size={20} />
              {item.badge && <span className="badge success">{item.badge}</span>}
              <h3>{item.name || "GÓI CREDIT"}</h3>
              <div className="priceBlock compact">
                {hasSale(item) && (
                  <div className="priceOriginal">
                    {Number(item.price).toLocaleString("vi-VN")}<span>{CURRENCY}</span>
                  </div>
                )}
                <strong>{finalPrice(item).toLocaleString("vi-VN")}{CURRENCY}</strong>
              </div>
              {Number(appliedVoucher?.discountPercent || 0) > 0 && voucherAppliesToPackage(appliedVoucher, item) && (
                <span>
                  Sau voucher {appliedVoucher.code}: giảm {appliedVoucher.discountPercent}% từ {priceBeforeVoucher(item).toLocaleString("vi-VN")}{CURRENCY}
                </span>
              )}
              {appliedVoucher && !voucherAppliesToPackage(appliedVoucher, item) && (
                <span className="muted">Voucher {appliedVoucher.code} không áp dụng gói này</span>
              )}
              {hasSale(item) && (
                <span className="saleOnly" data-sale={item.salePercent}>Sale {item.salePercent}% từ {Number(item.price).toLocaleString("vi-VN")}{CURRENCY}</span>
              )}
              <strong>{finalCredit(item)} credit</strong>
              {Number(appliedVoucher?.creditBonus || 0) > 0 && voucherAppliesToPackage(appliedVoucher, item) && (
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
        <div className="topupCheckoutBox">
          {selectedPackage ? (
            <div>
              <span>Gói đang chọn</span>
              <strong>{selectedPackage.name || "GÓI CREDIT"}</strong>
              <p>
                Thanh toán {finalPrice(selectedPackage).toLocaleString("vi-VN")}{CURRENCY} để nhận {finalCredit(selectedPackage)} credit
                {appliedVoucher && voucherAppliesToPackage(appliedVoucher, selectedPackage) ? `, đã áp dụng voucher ${appliedVoucher.code}` : ""}.
              </p>
            </div>
          ) : (
            <div>
              <span>Chưa chọn gói</span>
              <strong>Chọn gói nạp</strong>
              <p>Chọn gói nạp và áp dụng voucher nếu có, sau đó bấm nút nạp ngay.</p>
            </div>
          )}
          <button className="primaryButton" type="button" disabled={!selectedPackage} onClick={topup}>
            <CreditCard size={18} />
            Nạp ngay
          </button>
        </div>
        {message && <p className="success" style={{ marginTop: 14 }}>{message}</p>}
        {error && <p className="error" style={{ marginTop: 14 }}>{error}</p>}
        {lastPaidPayment && (
          <div className="result" style={{ marginTop: 16, borderColor: "rgba(0, 255, 136, 0.45)" }}>
            <span>{t.paymentDone}</span>
            <strong>+{lastPaidPayment.credit} credit</strong>
            <p>Mã nạp {lastPaidPayment.paymentCode} đã xác nhận. Bạn có thể tạo lượt nạp mới.</p>
          </div>
        )}
        {payment && (
          <div className="result" style={{ marginTop: 16 }}>
            <span>Thông tin thanh toán</span>
            <div className="table">
              <div className="tableRow">
                <span>{t.amount}</span>
                <strong>{Number(payment.amount).toLocaleString("vi-VN")}{CURRENCY}</strong>
                <button className="smallButton" type="button" onClick={() => copyText(payment.amount, "amount")}>
                  {copied === "amount" ? <Check size={14} /> : <Copy size={14} />}
                  {t.copy}
                </button>
              </div>
              {Number(payment.discountAmount || 0) > 0 && (
                <div className="tableRow">
                  <span>Voucher</span>
                  <strong>{payment.voucherCode}</strong>
                  <span>-{Number(payment.discountAmount).toLocaleString("vi-VN")}{CURRENCY}</span>
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
                <span>Mã đơn</span>
                <strong>{payment.paymentCode}</strong>
                <button className="smallButton" type="button" onClick={() => copyText(payment.paymentCode, "code")}>
                  {copied === "code" ? <Check size={14} /> : <Copy size={14} />}
                  {t.copy}
                </button>
              </div>
              <div className="tableRow">
                <span>{t.status}</span>
                <strong>Thanh toán</strong>
                <span>{payment.status === "approved" ? t.credited : t.waitingPayment}</span>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
              Credit sẽ tự động cộng sau khi giao dịch được xác nhận.
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
                ? `Giảm ${appliedVoucher.discountPercent}% cho gói nạp. Giá sẽ giảm khi bạn chọn gói.`
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
