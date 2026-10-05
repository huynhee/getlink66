import React, { useEffect, useRef, useState } from "react";
import { Check, Copy, Gift, CreditCard, Sparkles, Wallet } from "lucide-react";
import { api } from "../api.js";
import { useMarketplacePrices } from "../utils/useMarketplacePrices.js";
import { translations } from "../i18n.js";
import { membershipBenefitLabels, membershipDurationLabel } from "../utils/membershipPresentation.js";
import { checkoutCurrency, discountedPaymentPrice, formatPaymentMoney, packagePrice, submitPaymentCheckout } from "../utils/paymentPresentation.js";

const PENDING_TOPUP_ID_KEY = "pendingSepayTopupId";
const PENDING_MEMBERSHIP_ORDER_KEY = "pendingMembershipOrderId";

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
  ["orderKind", "orderId", "token", "PayerID"].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function modeFromLocation() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  if (mode === "pro") return "pro";
  if (params.get("packageId")) return "credit";
  if (params.get("planId")) return "pro";
  return mode === "credit" ? "credit" : "";
}

function queryParam(name) {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(name) || "";
}

function isDailyMembershipPlan(plan) {
  return String(plan?.code || "").toUpperCase() === "DAILY" || Number(plan?.durationDays || 0) <= 1;
}

function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `topup-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

export default function Topup({ user, onUserChange, language = "vi" }) {
  const t = translations[language] || translations.vi;
  const locale = language === "vi" ? "vi-VN" : "en-US";
  const currency = checkoutCurrency(language);
  const money = (value, valueLocale = locale, valueCurrency = currency) => formatPaymentMoney(value, valueCurrency, valueLocale);
  const [paypalEnabled, setPaypalEnabled] = useState(false);
  const [packages, setPackages] = useState([]);
  const [membershipPlans, setMembershipPlans] = useState([]);
  const [membership, setMembership] = useState(null);
  const [voucher, setVoucher] = useState("");
  const [appliedVoucher, setAppliedVoucher] = useState(null);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [selectedMembershipPlanId, setSelectedMembershipPlanId] = useState("");
  const [payment, setPayment] = useState(null);
  const [lastPaidPayment, setLastPaidPayment] = useState(null);
  const [copied, setCopied] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [proMessage, setProMessage] = useState("");
  const [proError, setProError] = useState("");
  const [proLoading, setProLoading] = useState(false);
  const [voucherMessage, setVoucherMessage] = useState("");
  const [voucherError, setVoucherError] = useState("");
  const [topupMode, setTopupModeState] = useState(modeFromLocation);
  const marketplacePrices = useMarketplacePrices();

  function changeTopupMode(nextMode) {
    const normalizedMode = nextMode === "credit" ? "credit" : "pro";
    setTopupModeState(normalizedMode);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("mode", normalizedMode);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function updateTopupSelectionQuery(updates = {}, removals = []) {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    Object.entries(updates).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
    removals.forEach((key) => url.searchParams.delete(key));
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }
  const [submitting, setSubmitting] = useState(false);
  const membershipRequestKeyRef = useRef("");
  const topupRequestKeyRef = useRef("");

  useEffect(() => {
    api("/api/topup/packages").then((data) => {
      setPaypalEnabled(data.payments?.paypal?.enabled === true);
      const nextPackages = data.packages || [];
      setPackages(nextPackages);
      const packageId = queryParam("packageId");
      if (packageId && nextPackages.some((item) => String(item._id) === String(packageId))) {
        setSelectedPackageId(packageId);
      }
    }).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    api("/api/membership/plans")
      .then((data) => {
        const nextPlans = data.plans || [];
        setMembershipPlans(nextPlans);
        const planId = queryParam("planId");
        setSelectedMembershipPlanId((current) => {
          if (planId && nextPlans.some((item) => String(item._id) === String(planId))) return planId;
          return current || nextPlans[0]?._id || "";
        });
      })
      .catch((err) => setProError(err.message));
  }, []);

  useEffect(() => {
    if (!user?._id) {
      setMembership(null);
      return;
    }
    api("/api/membership/me")
      .then((data) => setMembership(data.membership || null))
      .catch(() => { });
  }, [user?._id, user?.proUntil]);

  useEffect(() => {
    const paymentStatus = new URLSearchParams(window.location.search).get("payment");
    if (!paymentStatus) return undefined;
    if (paymentStatus.startsWith("paypal_")) return undefined;
    const pendingTopupId = window.sessionStorage.getItem(PENDING_TOPUP_ID_KEY);
    const pendingMembershipOrderId = window.sessionStorage.getItem(PENDING_MEMBERSHIP_ORDER_KEY);
    if (pendingMembershipOrderId && !pendingTopupId) return undefined;
    changeTopupMode("credit");

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
            onUserChange((current) => current ? { ...current, credit: data.userCredit } : current);
            setMessage(language === "vi"
              ? `Nạp thành công: +${data.topup.credit} credit. Số dư hiện tại: ${data.userCredit} credit`
              : `Top-up successful: +${data.topup.credit} credit. Current balance: ${data.userCredit} credit`);
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
          const nextCredit = Number(history.userCredit);
          if (Number.isFinite(nextCredit)) {
            onUserChange((current) => current ? { ...current, credit: nextCredit } : current);
          }
          setLastPaidPayment(latestApproved);
          clearPaymentQuery();
          setMessage(language === "vi"
            ? `Nạp thành công: +${latestApproved.credit} credit.${Number.isFinite(nextCredit) ? ` Số dư hiện tại: ${nextCredit} credit` : ""}`
            : `Top-up successful: +${latestApproved.credit} credit.${Number.isFinite(nextCredit) ? ` Current balance: ${nextCredit} credit` : ""}`);
        })
        .catch(() => { });
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
          clearPaymentQuery();
          onUserChange((current) => current ? { ...current, credit: data.userCredit } : current);
          setMessage(language === "vi"
            ? `Nạp thành công: +${data.topup.credit} credit. Số dư hiện tại: ${data.userCredit} credit`
            : `Top-up successful: +${data.topup.credit} credit. Current balance: ${data.userCredit} credit`);
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
  }, [language, onUserChange, t.checkingPayment, t.paymentCanceled, t.paymentError, user]);

  useEffect(() => {
    if (!payment || payment.status !== "pending") return undefined;

    const timer = window.setInterval(async () => {
      try {
        const data = await api(`/api/topup/${payment._id}/status`);
        if (data.status === "approved") {
          setLastPaidPayment(data.topup);
          setPayment(null);
          window.sessionStorage.removeItem(PENDING_TOPUP_ID_KEY);
          clearPaymentQuery();
          onUserChange((current) => current ? { ...current, credit: data.userCredit } : current);
          setMessage(language === "vi"
            ? `Nạp thành công: +${data.topup.credit} credit. Số dư hiện tại: ${data.userCredit} credit`
            : `Top-up successful: +${data.topup.credit} credit. Current balance: ${data.userCredit} credit`);
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
  }, [language, onUserChange, payment, t.paymentCanceled, user]);

  useEffect(() => {
    const paymentStatus = new URLSearchParams(window.location.search).get("payment");
    if (paymentStatus?.startsWith("paypal_")) return undefined;
    const pendingOrderId = window.sessionStorage.getItem(PENDING_MEMBERSHIP_ORDER_KEY);
    if (!paymentStatus || !pendingOrderId || !user) return undefined;
    changeTopupMode("pro");

    if (["error", "cancel"].includes(paymentStatus)) {
      let canceled = false;
      async function closePendingMembershipOrder() {
        try {
          await api(`/api/membership/orders/${pendingOrderId}/cancel`, {
            method: "POST",
            body: JSON.stringify({
              reason: paymentStatus === "error" ? "gateway_error" : "user_cancel",
            }),
          });
          if (canceled) return;
          window.sessionStorage.removeItem(PENDING_MEMBERSHIP_ORDER_KEY);
          clearPaymentQuery();
          if (paymentStatus === "error") {
            setProError(language === "vi" ? "Thanh toán Pro bị lỗi." : "Pro payment failed.");
          } else {
            setProMessage(language === "vi" ? "Đơn Pro đã hủy." : "Pro order canceled.");
          }
        } catch (err) {
          if (!canceled) setProError(err.message);
        }
      }
      closePendingMembershipOrder();
      return () => {
        canceled = true;
      };
    }

    setProMessage(language === "vi" ? "Đang kiểm tra thanh toán Pro..." : "Checking Pro payment...");
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      try {
        const data = await api(`/api/membership/orders/${pendingOrderId}/status`);
        if (data.status === "approved") {
          window.sessionStorage.removeItem(PENDING_MEMBERSHIP_ORDER_KEY);
          clearPaymentQuery();
          setMembership(data.membership || null);
          onUserChange?.((current) => current ? {
            ...current,
            proUntil: data.membership?.proUntil,
            isPro: data.membership?.active,
          } : current);
          setProMessage(language === "vi" ? "Đã kích hoạt gói Pro." : "Pro membership activated.");
          window.clearInterval(timer);
        } else if (data.status === "rejected") {
          window.sessionStorage.removeItem(PENDING_MEMBERSHIP_ORDER_KEY);
          clearPaymentQuery();
          setProMessage(language === "vi" ? "Đơn Pro đã hủy." : "Pro order canceled.");
          window.clearInterval(timer);
        }
      } catch {
        // Keep polling while the gateway redirects back.
      }
      if (attempts >= 20) window.clearInterval(timer);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [user, onUserChange, language]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("payment");
    const kind = params.get("orderKind");
    const id = params.get("orderId");
    if (!result?.startsWith("paypal_") || !user?._id || !["topup", "membership"].includes(kind) || !/^[a-f0-9]{24}$/i.test(id || "")) return undefined;
    let canceled = false;
    let timer;
    let attempts = 0;
    const setFeedback = kind === "membership" ? setProMessage : setMessage;
    const setFailure = kind === "membership" ? setProError : setError;
    const statusPath = kind === "membership" ? `/api/membership/orders/${id}` : `/api/topup/${id}`;
    setTopupModeState(kind === "membership" ? "pro" : "credit");
    setFeedback(language === "vi" ? "Đang xác nhận thanh toán PayPal..." : "Confirming PayPal payment...");

    function accept(data) {
      if (canceled) return true;
      if (data.status === "approved") {
        setFailure("");
        window.sessionStorage.removeItem(kind === "membership" ? PENDING_MEMBERSHIP_ORDER_KEY : PENDING_TOPUP_ID_KEY);
        if (kind === "membership") {
          setMembership(data.membership);
          onUserChange?.((current) => current ? { ...current, proUntil: data.membership?.proUntil, isPro: data.membership?.active, proDailyDownloadLimit: data.membership?.dailyDownloadLimit } : current);
        } else {
          setLastPaidPayment(data.topup);
          setPayment(null);
          onUserChange?.((current) => current ? { ...current, credit: data.userCredit } : current);
        }
        setFeedback(language === "vi" ? "Thanh toán thành công. Tài khoản đã được cập nhật." : "Payment successful. Your account has been updated.");
        clearPaymentQuery();
        return true;
      }
      if (data.status === "rejected") {
        setFeedback(language === "vi" ? "Đơn thanh toán đã hủy hoặc hết hạn." : "Payment order canceled or expired.");
        clearPaymentQuery();
        return true;
      }
      return false;
    }

    async function poll() {
      if (canceled) return;
      try { if (accept(await api(`${statusPath}/status`))) return; }
      catch (err) { if (!canceled) setFailure(err.message); }
      attempts += 1;
      if (!canceled && attempts < 40) timer = window.setTimeout(poll, 3000);
      else if (!canceled) setFeedback(language === "vi" ? "Thanh toán đang được đối soát. Bạn có thể kiểm tra lại đơn này sau." : "Payment reconciliation is pending. You can check this order again later.");
    }

    async function confirm() {
      try {
        const data = result === "paypal_cancel"
          ? await api(`${statusPath}/cancel`, { method: "POST", body: JSON.stringify({ reason: "user_cancel" }) })
          : await api(`/api/payments/paypal/orders/${kind}/${id}/capture`, { method: "POST", body: "{}" });
        if (accept(data)) return;
      } catch (err) { if (!canceled) setFailure(err.message); }
      await poll();
    }
    confirm();
    return () => { canceled = true; window.clearTimeout(timer); };
  }, [user?._id, onUserChange, language]);

  function priceBeforeVoucher(item) {
    return packagePrice(item, language);
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
      const discounted = discountedPaymentPrice(priceAfterSale, appliedVoucher.discountPercent, currency);
      return discounted === null ? null : currency === "USD" ? Math.max(0.01, discounted) : discounted;
    }
    return priceAfterSale;
  }

  function hasSale(item) {
    if (language === "en") return false;
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
  const selectedMembershipPlan = membershipPlans.find((item) => String(item._id) === String(selectedMembershipPlanId));
  const hasSelectedTopupMode = topupMode === "credit" || topupMode === "pro";
  const voucherTargetsMembership =
    appliedVoucher &&
    topupMode === "pro" &&
    appliedVoucher.appliesToMembership !== false &&
    Number(appliedVoucher.discountPercent || 0) > 0;
  const selectedPlanIsDailyAddon = membership?.active && isDailyMembershipPlan(selectedMembershipPlan);
  const canBuyCredit = selectedPackage && finalPrice(selectedPackage) !== null && (language !== "en" || paypalEnabled) && finalPrice(selectedPackage) >= (currency === "USD" ? 0.01 : 1000);
  const canBuyPro = selectedMembershipPlan && membershipFinalPrice(selectedMembershipPlan) !== null && (language !== "en" || paypalEnabled || membershipFinalPrice(selectedMembershipPlan) === 0);

  function membershipFinalPrice(plan) {
    const original = packagePrice(plan, language, { pro: true });
    if (!voucherTargetsMembership) return original;
    return discountedPaymentPrice(original, appliedVoucher.discountPercent, currency);
  }

  function selectPackage(item) {
    changeTopupMode("credit");
    updateTopupSelectionQuery({ packageId: item._id }, ["planId"]);
    setSelectedPackageId(item._id);
    setPayment(null);
    setLastPaidPayment(null);
    setMessage("");
    setError("");
  }

  async function checkoutMembership() {
    changeTopupMode("pro");
    if (proLoading || membershipRequestKeyRef.current) return;
    if (!user) {
      setProError(language === "vi" ? "Vui lòng đăng nhập trước khi mua Pro." : "Please sign in before buying Pro.");
      return;
    }
    if (!selectedMembershipPlan) {
      setProError(language === "vi" ? "Vui lòng chọn gói Pro." : "Please select a Pro plan.");
      return;
    }
    setProLoading(true);
    membershipRequestKeyRef.current = createIdempotencyKey();
    setProMessage("");
    setProError("");
    try {
      const data = await api("/api/membership/checkout", {
        method: "POST",
        headers: { "Idempotency-Key": membershipRequestKeyRef.current },
        body: JSON.stringify({
          planId: selectedMembershipPlan._id,
          paymentProvider: language === "en" ? "paypal" : "sepay",
          voucherCode: voucherTargetsMembership ? appliedVoucher?.code : undefined,
        }),
      });
      if (data.status === "approved") {
        window.sessionStorage.removeItem(PENDING_MEMBERSHIP_ORDER_KEY);
        setMembership(data.membership || null);
        onUserChange?.((current) => current ? {
          ...current,
          proUntil: data.membership?.proUntil,
          isPro: data.membership?.active,
          proDailyDownloadLimit: data.membership?.dailyDownloadLimit
            ?? current.proDailyDownloadLimit,
        } : current);
        setProMessage(language === "vi"
          ? "Đã kích hoạt gói Pro miễn phí."
          : "Free Pro plan activated.");
        return;
      }
      if (data.order?._id) {
        window.sessionStorage.setItem(PENDING_MEMBERSHIP_ORDER_KEY, data.order._id);
      }
      setProMessage(language === "vi" ? "Đang chuyển sang cổng thanh toán..." : "Redirecting to payment...");
      if (!submitPaymentCheckout(data.payment)) {
        setProMessage(language === "vi" ? "Đã tạo đơn Pro. Vui lòng hoàn tất thanh toán." : "Pro order created. Please complete payment.");
      }
    } catch (err) {
      setProError(err.message);
    } finally {
      membershipRequestKeyRef.current = "";
      setProLoading(false);
    }
  }

  async function topup() {
    changeTopupMode("credit");
    if (submitting || topupRequestKeyRef.current) return;
    if (!selectedPackage) {
      setError(t.selectPackageBeforePayment);
      return;
    }

    setSubmitting(true);
    topupRequestKeyRef.current = createIdempotencyKey();
    try {
      setMessage("");
      setError("");
      setPayment(null);
      setLastPaidPayment(null);
      const data = await api("/api/topup", {
        method: "POST",
        headers: { "Idempotency-Key": topupRequestKeyRef.current },
        body: JSON.stringify({
          packageId: selectedPackage._id,
          paymentProvider: language === "en" ? "paypal" : "sepay",
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
        topupRequestKeyRef.current = "";
        setSubmitting(false);
      }
    } catch (err) {
      setError(err.message);
      topupRequestKeyRef.current = "";
      setSubmitting(false);
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
      setVoucherMessage("");
      setVoucherError("");
      const data = await api("/api/voucher/apply", {
        method: "POST",
        body: JSON.stringify({
          code: voucher,
          target: topupMode === "pro" ? "membership" : "topup",
          packageId: topupMode === "credit" && selectedPackage ? selectedPackage._id : undefined,
        }),
      });
      setAppliedVoucher(data.voucher || null);
      setPayment(null);
      setLastPaidPayment(null);
      setVoucher("");
      setVoucherMessage(data.message || t.voucherApplied);
    } catch (err) {
      setVoucherError(err.message);
    }
  }

  return (
    <div className="stack">
      <section className="topupPurposeGrid" role="tablist" aria-label={language === "vi" ? "Mục đích gói nạp" : "Top-up purposes"}>
        <button
          type="button"
          className={`topupPurposeItem credit ${topupMode === "credit" ? "active" : ""}`}
          onClick={() => changeTopupMode("credit")}
          role="tab"
          aria-selected={topupMode === "credit"}
        >
          <Wallet size={18} />
          <strong>Credit</strong>
          <span>
            {language === "vi"
              ? `Dùng cho Getlink và tải lẻ thư viện: Model ${marketplacePrices.model} Credit, Scene ${marketplacePrices.scene} Credit.`
              : `Use for Getlink and one-off library downloads: Model ${marketplacePrices.model} Credits, Scene ${marketplacePrices.scene} Credits.`}
          </span>
          <small>{language === "vi" ? "Phù hợp khi tải ít; không kích hoạt Pro hoặc cộng quota hằng ngày." : "Best for occasional downloads; does not activate Pro or add daily quota."}</small>
          <span className="topupPurposeState">
            {topupMode === "credit" && <Check size={13} />}
            {topupMode === "credit"
              ? (language === "vi" ? "Đang chọn" : "Selected")
              : (language === "vi" ? "Chọn Credit" : "Choose Credit")}
          </span>
        </button>
        <button
          type="button"
          className={`topupPurposeItem pro ${topupMode === "pro" ? "active" : ""}`}
          onClick={() => changeTopupMode("pro")}
          role="tab"
          aria-selected={topupMode === "pro"}
        >
          <Sparkles size={18} />
          <strong>Pro</strong>
          <span>
            {language === "vi"
              ? "Dành cho người tải thường xuyên: mở Model/Scene Pro, tải nhanh và quota theo ngày."
              : "For frequent downloaders: unlocks Pro Models/Scenes, fast downloads, and daily quota."}
          </span>
          <small>{language === "vi" ? "Không cộng thêm số dư Credit." : "Does not add Credit balance."}</small>
          <span className="topupPurposeState">
            {topupMode === "pro" && <Check size={13} />}
            {topupMode === "pro"
              ? (language === "vi" ? "Đang chọn" : "Selected")
              : (language === "vi" ? "Chọn Pro" : "Choose Pro")}
          </span>
        </button>
      </section>

      {hasSelectedTopupMode && (
        <div className={`topupCurrentModeNotice ${topupMode}`} role="status">
          <Check size={15} />
          <span>{language === "vi" ? "Hình thức đang chọn:" : "Selected top-up type:"}</span>
          <strong>
            {topupMode === "credit"
              ? (language === "vi" ? "Nạp Credit cho Getlink và tải lẻ" : "Credit for Getlink and one-off downloads")
              : (language === "vi" ? "Mua Pro để tải Model/Scene" : "Pro for Model/Scene downloads")}
          </strong>
        </div>
      )}

      {topupMode === "pro" && (
        <section className="panel topupUnifiedSection topupProSection">
          <div className="topupSectionHeader">
            <div>
              <span className="eyebrowSignal">3DIPL MEMBER</span>
              <h2><Sparkles size={20} /> {language === "vi" ? "Mua Pro" : "Buy Pro"}</h2>
              <p className="muted">
                {language === "vi"
                  ? "Pro dành cho người tải thường xuyên: dùng quota theo từng gói, Model trừ 1 lượt, Scene trừ 5 lượt và không trừ Credit."
                  : "Pro is for frequent downloads: each plan provides quota, Models cost 1 download, Scenes cost 5, and Credits are not charged."}
              </p>
            </div>
            {membership?.active && (
              <span className="badge success">
                {language === "vi" ? "Đang Pro đến" : "Pro until"} {new Date(membership.proUntil).toLocaleString(locale)}
              </span>
            )}
          </div>
          <div className="membershipPlans topupMembershipPlans">
            {membershipPlans.map((plan) => (
              <button
                key={plan._id}
                type="button"
                className={`membershipPlanCard panel ${selectedMembershipPlanId === plan._id ? "selectedPackage" : ""}`}
                onClick={() => {
                  updateTopupSelectionQuery({ mode: "pro", planId: plan._id }, ["packageId"]);
                  setSelectedMembershipPlanId(plan._id);
                  setProMessage("");
                  setProError("");
                }}
              >
                {plan.badge && <span className="badge success">{plan.badge}</span>}
                <h3>{plan.name}</h3>
                <strong>{money(membershipFinalPrice(plan), locale)}</strong>
                {voucherTargetsMembership && (
                  <span>{language === "vi" ? `Voucher ${appliedVoucher.code}: giảm ${appliedVoucher.discountPercent}%` : `Voucher ${appliedVoucher.code}: ${appliedVoucher.discountPercent}% off`}</span>
                )}
                <span>{membershipDurationLabel(plan, language)}</span>
                {Number(plan.maxPurchasesPerUser || 0) > 0 && (
                  <span className="muted">
                    {language === "vi"
                      ? `Mỗi tài khoản mua tối đa ${plan.maxPurchasesPerUser} lần`
                      : `Max ${plan.maxPurchasesPerUser} purchases per account`}
                  </span>
                )}
                <ul>
                  {membershipBenefitLabels(plan, language).map((feature) => (
                    <li key={feature}><Check size={14} /> {feature}</li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
          <div className="topupCheckoutBox">
            <div>
              <span>{language === "vi" ? "Gói Pro đang chọn" : "Selected Pro plan"}</span>
              <strong>{selectedMembershipPlan?.name || "-"}</strong>
              <p>
                {selectedMembershipPlan
                  ? (language === "vi"
                    ? (selectedPlanIsDailyAddon
                      ? `Thanh toán ${money(membershipFinalPrice(selectedMembershipPlan), locale)} để thêm ${selectedMembershipPlan.dailyDownloadLimit} lượt tải hôm nay; hạn Pro hiện tại vẫn giữ nguyên.`
                      : `Thanh toán ${money(membershipFinalPrice(selectedMembershipPlan), locale)} để kích hoạt ${selectedMembershipPlan.durationDays} ngày Pro đến cuối ngày hết hạn.`)
                    : (selectedPlanIsDailyAddon
                      ? `Pay ${money(membershipFinalPrice(selectedMembershipPlan), locale)} to add ${selectedMembershipPlan.dailyDownloadLimit} downloads today; your current Pro expiry stays unchanged.`
                      : `Pay ${money(membershipFinalPrice(selectedMembershipPlan), locale)} for ${selectedMembershipPlan.durationDays} days of Pro ending at the end of the final day.`))
                  : (language === "vi" ? "Chọn một gói Pro để tiếp tục." : "Select a Pro plan to continue.")}
              </p>
            </div>
            <button className="primaryButton" type="button" disabled={proLoading || !canBuyPro} onClick={checkoutMembership}>
              <CreditCard size={18} />
              {language === "vi" ? "Mua Pro" : canBuyPro && membershipFinalPrice(selectedMembershipPlan) > 0 ? "Pay with PayPal" : "Buy Pro"}
            </button>
          </div>
          {language === "en" && selectedMembershipPlan && !canBuyPro && <p className="muted">{membershipFinalPrice(selectedMembershipPlan) === null ? "USD price is not available for this plan yet." : "PayPal checkout is not available yet."}</p>}
          {proMessage && <p className="success" style={{ marginTop: 14 }}>{proMessage}</p>}
          {proError && <p className="error" style={{ marginTop: 14 }}>{proError}</p>}
        </section>
      )}

      {topupMode === "credit" && (
        <section className="panel topupUnifiedSection topupCreditSection">
          <div className="topupSectionHeader">
            <div>
              <span className="eyebrowSignal">CREDIT BALANCE</span>
              <h2><Wallet size={20} /> {language === "vi" ? "Nạp Credit" : "Top up Credit"}</h2>
              <p className="muted">
                {language === "vi"
                  ? `Credit dùng cho Getlink và tải nhỏ lẻ trong thư viện. Tỉ lệ Getlink 1:1 với 3d66 (trung bình 28 Credit/model); tải thư viện: Model ${marketplacePrices.model} Credit, Scene ${marketplacePrices.scene} Credit.`
                  : `Credits work for Getlink and occasional library downloads. Getlink follows the 3d66 1:1 rate (about 28 Credits/model); library downloads cost ${marketplacePrices.model} Credits per Model and ${marketplacePrices.scene} Credits per Scene.`}
              </p>
            </div>
            <span className="badge success">{language === "vi" ? "ĐANG NẠP CREDIT" : "CREDIT TOP-UP"}</span>
          </div>
          <div className="packageGrid topupPackageGrid" style={{ "--topup-package-count": Math.max(packages.length, 1) }}>
            {packages.map((item) => (
              <button
                className={`membershipPlanCard panel topupPackageCard ${selectedPackageId === item._id ? "selectedPackage" : ""}`}
                key={item._id || item.price}
                onClick={() => selectPackage(item)}
                style={{ alignItems: "stretch", textAlign: "left" }}
              >
                {item.badge && <span className="badge success topupPackageBadge">{item.badge}</span>}
                <h3 className="topupPackageName">{item.name || t.defaultPackageName}</h3>
                <div className="priceBlock compact topupPackagePrice">
                  {hasSale(item) && (
                    <div className="priceOriginal">
                      {money(item.price)}
                    </div>
                  )}
                  <strong className="topupPackageFinalPrice">{money(finalPrice(item))}</strong>
                </div>
                {Number(appliedVoucher?.discountPercent || 0) > 0 && voucherAppliesToPackage(appliedVoucher, item) && (
                  <span>
                    {language === "vi"
                      ? `Sau voucher ${appliedVoucher.code}: giảm ${appliedVoucher.discountPercent}% từ ${money(priceBeforeVoucher(item))}`
                      : `After voucher ${appliedVoucher.code}: ${appliedVoucher.discountPercent}% off from ${money(priceBeforeVoucher(item))}`}
                  </span>
                )}
                {appliedVoucher && !voucherAppliesToPackage(appliedVoucher, item) && (
                  <span className="muted">Voucher {appliedVoucher.code} {t.voucherNotApplicable}</span>
                )}
                {hasSale(item) && (
                  <span className="topupPackageSale">
                    {Number(item.salePercent || 0) > 0
                      ? (language === "vi"
                        ? `Sale ${item.salePercent}% từ ${money(item.price)}`
                        : `Sale ${item.salePercent}% from ${money(item.price)}`)
                      : (language === "vi"
                        ? `Giá sale từ ${money(item.price)}`
                        : `Sale price from ${money(item.price)}`)}
                  </span>
                )}
                <strong className="topupPackageCredit">{finalCredit(item)} credit</strong>
                {Number(item.maxTopupsPerUser || 0) > 0 && (
                  <span className="muted">
                    {language === "vi"
                      ? `Mỗi tài khoản nạp tối đa ${item.maxTopupsPerUser} lần`
                      : `Max ${item.maxTopupsPerUser} top-ups per account`}
                  </span>
                )}
                {Number(appliedVoucher?.creditBonus || 0) > 0 && voucherAppliesToPackage(appliedVoucher, item) && (
                  <span>Bonus voucher {appliedVoucher.code}: +{appliedVoucher.creditBonus} credit</span>
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
                <span>{language === "vi" ? "Gói Credit đang chọn" : "Selected Credit package"}</span>
                <strong>{selectedPackage.name || t.defaultPackageName}</strong>
                <p>
                  {language === "vi"
                    ? `Thanh toán ${money(finalPrice(selectedPackage))} để nhận ${finalCredit(selectedPackage)} Credit dùng cho Getlink hoặc tải lẻ Model/Scene`
                    : `Pay ${money(finalPrice(selectedPackage))} to receive ${finalCredit(selectedPackage)} Credits for Getlink or one-off Model/Scene downloads`}
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
            <button className="primaryButton" type="button" disabled={!canBuyCredit || submitting} onClick={topup}>
              <CreditCard size={18} />
              {submitting ? t.redirectingPayment : (language === "vi" ? "Nạp Credit" : "Pay with PayPal")}
            </button>
          </div>
          {language === "en" && selectedPackage && !canBuyCredit && <p className="muted">{finalPrice(selectedPackage) === null ? "USD price is not available for this package yet." : "PayPal checkout is not available for this order."}</p>}
          {message && <p className="success" style={{ marginTop: 14 }}>{message}</p>}
          {error && <p className="error" style={{ marginTop: 14 }}>{error}</p>}
          {lastPaidPayment && (
            <div className="result" style={{ marginTop: 16, borderColor: "rgba(0, 255, 136, 0.45)" }}>
              <span>{t.paymentDone}</span>
              <strong>+{lastPaidPayment.credit} credit</strong>
              <p>
                {language === "vi"
                  ? `Mã nạp ${lastPaidPayment.paymentCode || lastPaidPayment.paypalOrderId || lastPaidPayment._id} đã xác nhận. Bạn có thể tạo lượt nạp mới.`
                  : `Top-up code ${lastPaidPayment.paymentCode || lastPaidPayment.paypalOrderId || lastPaidPayment._id} has been confirmed. You can create a new top-up.`}
              </p>
            </div>
          )}
          {payment && (
            <div className="result" style={{ marginTop: 16 }}>
              <span>{t.paymentInfo}</span>
              <div className="table">
                <div className="tableRow">
                  <span>{t.amount}</span>
                  <strong>{money(payment.amount, locale, payment.currency || "VND")}</strong>
                  <button className="smallButton" type="button" onClick={() => copyText(payment.amount, "amount")}>
                    {copied === "amount" ? <Check size={14} /> : <Copy size={14} />}
                    {t.copy}
                  </button>
                </div>
                {Number(payment.discountAmount || 0) > 0 && (
                  <div className="tableRow">
                    <span>Voucher</span>
                    <strong>{payment.voucherCode}</strong>
                    <span>-{money(payment.discountAmount, locale, payment.currency || "VND")}</span>
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
                  <span>{t.orderCode}</span>
                  <strong>{payment.paymentCode || payment.paypalOrderId || payment._id}</strong>
                  <button className="smallButton" type="button" onClick={() => copyText(payment.paymentCode, "code")}>
                    {copied === "code" ? <Check size={14} /> : <Copy size={14} />}
                    {t.copy}
                  </button>
                </div>
                <div className="tableRow">
                  <span>{t.status}</span>
                  <strong>{payment.gatewayProvider === "paypal" ? "PayPal" : t.paymentLabel}</strong>
                  <span>{payment.status === "approved" ? t.credited : t.waitingPayment}</span>
                </div>
              </div>
              <p className="muted" style={{ marginTop: 12 }}>
                {t.creditAutoAfterConfirm}
              </p>
            </div>
          )}
        </section>
      )}

      {hasSelectedTopupMode && <section className="panel topupVoucherPanel">
        <div>
          <h2><Gift size={18} /> Voucher</h2>
          <p className="muted">
            {language === "vi"
              ? `Áp dụng cho ${topupMode === "pro" ? "gói Pro đang chọn" : "gói Credit đang chọn"}. Đổi tab vẫn giữ voucher đã nhập.`
              : `Applies to the selected ${topupMode === "pro" ? "Pro" : "Credit"} package. Switching tabs keeps the voucher.`}
          </p>
        </div>
        <form className="inputRow topupVoucherRow" onSubmit={applyVoucher}>
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
        {voucherMessage && <p className="success">{voucherMessage}</p>}
        {voucherError && <p className="error">{voucherError}</p>}
        {appliedVoucher && (
          <div className="result topupVoucherResult">
            <span>{t.voucherInfo}</span>
            <strong>{appliedVoucher.code}</strong>
            {appliedVoucher.description && <p>{appliedVoucher.description}</p>}
            <p>
              {appliedVoucher.discountPercent > 0
                ? (language === "vi"
                  ? `Giảm ${appliedVoucher.discountPercent}% cho thanh toán phù hợp.`
                  : `${appliedVoucher.discountPercent}% off eligible payments.`)
                : (language === "vi"
                  ? `Cộng thêm ${appliedVoucher.creditBonus} credit khi nạp Credit thành công.`
                  : `Adds ${appliedVoucher.creditBonus} bonus credits after a successful Credit top-up.`)}
            </p>
          </div>
        )}
      </section>}
    </div>
  );
}
