import React, { useEffect, useState } from "react";
import { Check, Copy, Gift, CreditCard, QrCode } from "lucide-react";
import CoinAmount from "../components/CoinAmount.jsx";
import { api } from "../api.js";
import { translations } from "../i18n.js";

const CURRENCY = "đ";
const PENDING_TOPUP_ID_KEY = "pendingSepayTopupId";

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

function clearPaymentQuery() {
  const url = new URL(window.location.href);
  url.searchParams.delete("payment");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export default function Topup({ user, onUserChange, language = "vi" }) {
  const t = translations[language] || translations.vi;
  const locale = language === "vi" ? "vi-VN" : "en-US";
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
    const pendingTopupId = window.sessionStorage.getItem(PENDING_TOPUP_ID_KEY);

    if (["error", "cancel"].includes(paymentStatus)) {
      let canceled = false;

      async function closePendingPayment() {
        if (!pendingTopupId) {
          clearPaymentQuery();
          if (paymentStatus === "error") setError(t.paymentError);
          else setMessage(t.paymentCanceled);
          return;
        }

        try {
          const data = await api(`/api/topup/${pendingTopupId}/cancel`, {
            method: "POST",
            body: JSON.stringify({
              reason: paymentStatus === "error" ? "gateway_error" : "user_cancel",
            }),
          });
          if (canceled) return;

          window.sessionStorage.removeItem(PENDING_TOPUP_ID_KEY);
          clearPaymentQuery();
          setPayment(null);

          if (data.status === "approved") {
            setLastPaidPayment(data.topup);
            onUserChange({ ...user, credit: data.userCredit });
            setMessage(language === "vi"
              ? `Nạp thành công: +${data.topup.credit} coin. Số dư hiện tại: ${data.userCredit} coin`
              : `Top-up successful: +${data.topup.credit} coin. Current balance: ${data.userCredit} coin`);
            return;
          }

          if (paymentStatus === "error") setError(t.paymentError);
          else setMessage(t.paymentCanceled);
        } catch (err) {
          if (!canceled) setError(err.message);
        }
      }

      closePendingPayment();
      return () => {
        canceled = true;
      };
    }

    setMessage(t.checkingPayment);
    if (!pendingTopupId) {
      api("/api/topup/history")
        .then((history) => {
          const latestApproved = recentApprovedTopup(history.history || []);
          if (!latestApproved) return;
          setLastPaidPayment(latestApproved);
          setMessage(language === "vi"
            ? `Nạp thành công: +${latestApproved.credit} coin.`
            : `Top-up successful: +${latestApproved.credit} coin.`);
        })
        .catch(() => {});
      return undefined;
    }

    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      try {
        const data = await api(`/api/topup/${pendingTopupId}/status`);
        if (data.status === "approved") {
          setLastPaidPayment(data.topup);
          window.sessionStorage.removeItem(PENDING_TOPUP_ID_KEY);
          onUserChange({ ...user, credit: data.userCredit });
          setMessage(language === "vi"
            ? `Nạp thành công: +${data.topup.credit} coin. Số dư hiện tại: ${data.userCredit} coin`
            : `Top-up successful: +${data.topup.credit} coin. Current balance: ${data.userCredit} coin`);
          window.clearInterval(timer);
        } else if (data.status === "rejected") {
          window.sessionStorage.removeItem(PENDING_TOPUP_ID_KEY);
          clearPaymentQuery();
          setPayment(null);
          setMessage(t.paymentCanceled);
          window.clearInterval(timer);
        }
      } catch {
        /* keep polling */
      }
      if (attempts >= 20) window.clearInterval(timer);
    }, 3000);

    return () => window.clearInterval(timer);
  }, [onUserChange, user]);

  useEffect(() => {
    if (!payment || payment.status !== "pending") return undefined;

    const timer = window.setInterval(async () => {
      try {
        const data = await api(`/api/topup/${payment._id}/status`);
        if (data.status === "approved") {
          setLastPaidPayment(data.topup);
          setPayment(null);
          window.sessionStorage.removeItem(PENDING_TOPUP_ID_KEY);
          onUserChange({ ...user, credit: data.userCredit });
          setMessage(language === "vi"
            ? `Nạp thành công: +${data.topup.credit} coin. Số dư hiện tại: ${data.userCredit} coin`
            : `Top-up successful: +${data.topup.credit} coin. Current balance: ${data.userCredit} coin`);
          window.clearInterval(timer);
        } else if (data.status === "rejected") {
          setPayment(null);
          window.sessionStorage.removeItem(PENDING_TOPUP_ID_KEY);
          setMessage(t.paymentCanceled);
          window.clearInterval(timer);
        }
      } catch {
        /* keep polling */
      }
    }, 5000);

    return () => window.clearInterval(timer);
  }, [payment, onUserChange, user]);

  function priceBeforeVoucher(item) {
    if (Number(item.salePrice || 0) > 0) return Number(item.salePrice || 0);
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
    return (
      Number(item.salePercent || 0) > 0 ||
      (Number(item.salePrice || 0) > 0 &&
        Number(item.salePrice || 0) < Number(item.price || 0))
    );
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
      setError(t.selectPackageBeforePayment);
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
      if (data.topup?._id) {
        window.sessionStorage.setItem(PENDING_TOPUP_ID_KEY, data.topup._id);
      }
      setMessage(t.redirectingPayment);
      if (!submitPaymentCheckout(data.payment)) {
        setMessage(t.paymentOrderCreated);
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
      setMessage(data.message || t.voucherApplied);
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
        <div className="packageGrid topupPackageGrid" style={{ "--topup-package-count": Math.max(packages.length, 1) }}>
          {packages.map((item) => (
            <button
              className={`package topupPackageCard ${selectedPackageId === item._id ? "selectedPackage" : ""}`}
              key={item._id || item.price}
              onClick={() => selectPackage(item)}
              style={{ alignItems: "stretch", textAlign: "left" }}
            >
              {item.badge && <span className="badge success topupPackageBadge">{item.badge}</span>}
              <h3 className="topupPackageName">{item.name || t.defaultPackageName}</h3>
              <div className="priceBlock compact topupPackagePrice">
                {hasSale(item) && (
                  <div className="priceOriginal">
                    {Number(item.price).toLocaleString(locale)}<span>{CURRENCY}</span>
                  </div>
                )}
                <strong className="topupPackageFinalPrice">{finalPrice(item).toLocaleString(locale)}{CURRENCY}</strong>
              </div>
              {Number(appliedVoucher?.discountPercent || 0) > 0 && voucherAppliesToPackage(appliedVoucher, item) && (
                <span>
                  {language === "vi"
                    ? `Sau voucher ${appliedVoucher.code}: giảm ${appliedVoucher.discountPercent}% từ ${priceBeforeVoucher(item).toLocaleString(locale)}${CURRENCY}`
                    : `After voucher ${appliedVoucher.code}: ${appliedVoucher.discountPercent}% off from ${priceBeforeVoucher(item).toLocaleString(locale)}${CURRENCY}`}
                </span>
              )}
              {appliedVoucher && !voucherAppliesToPackage(appliedVoucher, item) && (
                <span className="muted">Voucher {appliedVoucher.code} {t.voucherNotApplicable}</span>
              )}
              {hasSale(item) && (
                <span className="saleOnly" data-sale={item.salePercent}>
                  {Number(item.salePercent || 0) > 0
                    ? (language === "vi"
                      ? `Sale ${item.salePercent}% từ ${Number(item.price).toLocaleString(locale)}${CURRENCY}`
                      : `Sale ${item.salePercent}% from ${Number(item.price).toLocaleString(locale)}${CURRENCY}`)
                    : (language === "vi"
                      ? `Giá sale từ ${Number(item.price).toLocaleString(locale)}${CURRENCY}`
                      : `Sale price from ${Number(item.price).toLocaleString(locale)}${CURRENCY}`)}
                </span>
              )}
              <strong className="topupPackageCredit"><CoinAmount value={finalCredit(item)} /></strong>
              {Number(item.maxTopupsPerUser || 0) > 0 && (
                <span className="muted">
                  {language === "vi"
                    ? `Mỗi tài khoản nạp tối đa ${item.maxTopupsPerUser} lần`
                    : `Max ${item.maxTopupsPerUser} top-ups per account`}
                </span>
              )}
              {Number(appliedVoucher?.creditBonus || 0) > 0 && voucherAppliesToPackage(appliedVoucher, item) && (
                <span>Bonus voucher {appliedVoucher.code}: <CoinAmount value={appliedVoucher.creditBonus} prefix="+" /></span>
              )}
              <ul className="topupPackageFeatures">
                {((item.features && item.features.length > 0)
                  ? item.features
                  : t.defaultPackageFeatures
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
              <span>{t.selectedPackage}</span>
              <strong>{selectedPackage.name || t.defaultPackageName}</strong>
              <p>
                {language === "vi"
                  ? <>Thanh toán {finalPrice(selectedPackage).toLocaleString(locale)}{CURRENCY} để nhận <CoinAmount value={finalCredit(selectedPackage)} /></>
                  : <>Pay {finalPrice(selectedPackage).toLocaleString(locale)}{CURRENCY} to receive <CoinAmount value={finalCredit(selectedPackage)} /></>}
                {appliedVoucher && voucherAppliesToPackage(appliedVoucher, selectedPackage)
                  ? (language === "vi" ? `, đã áp dụng voucher ${appliedVoucher.code}` : `, voucher ${appliedVoucher.code} applied`)
                  : ""}.
              </p>
            </div>
          ) : (
            <div>
              <span>{t.noPackageSelected}</span>
              <strong>{t.selectTopupPackage}</strong>
              <p>{t.selectPackageHelp}</p>
            </div>
          )}
          <button className="primaryButton" type="button" disabled={!selectedPackage} onClick={topup}>
            <CreditCard size={18} />
            {t.topupNow}
          </button>
        </div>
        {message && <p className="success" style={{ marginTop: 14 }}>{message}</p>}
        {error && <p className="error" style={{ marginTop: 14 }}>{error}</p>}
        {lastPaidPayment && (
          <div className="result" style={{ marginTop: 16, borderColor: "rgba(0, 255, 136, 0.45)" }}>
            <span>{t.paymentDone}</span>
            <strong><CoinAmount value={lastPaidPayment.credit} prefix="+" /></strong>
            <p>
              {language === "vi"
                ? `Mã nạp ${lastPaidPayment.paymentCode} đã xác nhận. Bạn có thể tạo lượt nạp mới.`
                : `Top-up code ${lastPaidPayment.paymentCode} has been confirmed. You can create a new top-up.`}
            </p>
          </div>
        )}
        {payment && (
          <div className="result" style={{ marginTop: 16 }}>
            <span>{t.paymentInfo}</span>
            <div className="table">
              <div className="tableRow">
                <span>{t.amount}</span>
                <strong>{Number(payment.amount).toLocaleString(locale)}{CURRENCY}</strong>
                <button className="smallButton" type="button" onClick={() => copyText(payment.amount, "amount")}>
                  {copied === "amount" ? <Check size={14} /> : <Copy size={14} />}
                  {t.copy}
                </button>
              </div>
              {Number(payment.discountAmount || 0) > 0 && (
                <div className="tableRow">
                  <span>Voucher</span>
                  <strong>{payment.voucherCode}</strong>
                  <span>-{Number(payment.discountAmount).toLocaleString(locale)}{CURRENCY}</span>
                </div>
              )}
              {payment.voucherCode && Number(payment.discountAmount || 0) <= 0 && (
                <div className="tableRow">
                  <span>Voucher</span>
                  <strong>{payment.voucherCode}</strong>
                  <span><CoinAmount value={Number(payment.voucherCreditBonus || 0)} prefix="+" /></span>
                </div>
              )}
              <div className="tableRow">
                <span>{t.orderCode}</span>
                <strong>{payment.paymentCode}</strong>
                <button className="smallButton" type="button" onClick={() => copyText(payment.paymentCode, "code")}>
                  {copied === "code" ? <Check size={14} /> : <Copy size={14} />}
                  {t.copy}
                </button>
              </div>
              <div className="tableRow">
                <span>{t.status}</span>
                <strong>{t.paymentLabel}</strong>
                <span>{payment.status === "approved" ? t.credited : t.waitingPayment}</span>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
              {t.creditAutoAfterConfirm}
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
                ? (language === "vi"
                  ? `Giảm ${appliedVoucher.discountPercent}% cho gói nạp. Giá sẽ giảm khi bạn chọn gói.`
                  : `${appliedVoucher.discountPercent}% off top-up packages. The price will decrease when you select a package.`)
                : (language === "vi"
                  ? <>Cộng thêm <CoinAmount value={appliedVoucher.creditBonus} /> khi nạp thành công.</>
                  : <>Add <CoinAmount value={appliedVoucher.creditBonus} /> after a successful top-up.</>)}
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
