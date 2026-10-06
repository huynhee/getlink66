import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CheckCircle2, Copy, CreditCard, Gift, History, Loader2, ShieldCheck, Sparkles, Wallet, X } from "lucide-react";
import { api } from "../api.js";
import { useMarketplacePrices } from "../utils/useMarketplacePrices.js";
import { translations } from "../i18n.js";
import { initialSubscriptionSelection, subscriptionApprovalMessage, subscriptionCheckoutDescription, subscriptionDateLabel, subscriptionPlanPrice } from "../utils/membershipPresentation.js";
import SubscriptionPlans from "../components/SubscriptionPlans.jsx";
import SubscriptionSchedule from "../components/SubscriptionSchedule.jsx";
import { checkoutCurrency, discountedPaymentPrice, formatPaymentMoney, packagePrice, submitPaymentCheckout } from "../utils/paymentPresentation.js";
import "./topup.css";

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
  if (typeof window === "undefined") return "pro";
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  if (mode === "pro" || mode === "credit") return mode;
  if (params.get("packageId")) return "credit";
  if (params.get("planId")) return "pro";
  return "pro";
}

function queryParam(name) {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(name) || "";
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
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [membershipPlans, setMembershipPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [subscriptionPeriod, setSubscriptionPeriod] = useState("month");
  const [subscriptionCheckoutEnabled, setSubscriptionCheckoutEnabled] = useState(true);
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
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [topupMode, setTopupModeState] = useState(modeFromLocation);
  const marketplacePrices = useMarketplacePrices();
  const modeButtons = useRef({});

  function handleModeKeyDown(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextMode = event.key === "Home" ? "pro" : event.key === "End" ? "credit" : topupMode === "pro" ? "credit" : "pro";
    changeTopupMode(nextMode);
    modeButtons.current[nextMode]?.focus();
  }

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
    let canceled = false;
    api("/api/topup/packages").then((data) => {
      if (canceled) return;
      setPaypalEnabled(data.payments?.paypal?.enabled === true);
      const nextPackages = data.packages || [];
      setPackages(nextPackages);
      const packageId = queryParam("packageId");
      if (packageId && nextPackages.some((item) => String(item._id) === String(packageId))) {
        setSelectedPackageId(packageId);
      }
    }).catch((err) => { if (!canceled) setError(err.message); })
      .finally(() => { if (!canceled) setPackagesLoading(false); });
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    let canceled = false;
    api("/api/membership/plans")
      .then((data) => {
        if (canceled) return;
        const nextPlans = data.plans || [];
        setMembershipPlans(nextPlans);
        setSubscriptionCheckoutEnabled(data.checkoutEnabled !== false);
        const selection = initialSubscriptionSelection(nextPlans, queryParam("planId"));
        setSubscriptionPeriod(selection.period);
        setSelectedMembershipPlanId(selection.planId);
      })
      .catch((err) => { if (!canceled) setProError(err.message); })
      .finally(() => { if (!canceled) setPlansLoading(false); });
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    if (!user?._id) {
      setMembership(null);
      return;
    }
    api("/api/membership/me")
      .then((data) => setMembership(data.membership || null))
      .catch(() => { });
  }, [user?._id, user?.proUntil, user?.proDailyDownloadLimit, user?.subscriptionCurrentPeriod?.id]);

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
            setProError(language === "vi" ? "Thanh toán Subscription bị lỗi." : "Subscription payment failed.");
          } else {
            setProMessage(language === "vi" ? "Đơn Subscription đã hủy." : "Subscription order canceled.");
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

    setProMessage(language === "vi" ? "Đang kiểm tra thanh toán Subscription..." : "Checking Subscription payment...");
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
            proDailyDownloadLimit: data.membership?.dailyDownloadLimit,
            subscriptionCurrentPeriod: data.membership?.currentPeriod,
          } : current);
          setProMessage(subscriptionApprovalMessage(data, language));
          api("/api/membership/me").then((details) => setMembership(details.membership)).catch(() => {});
          window.clearInterval(timer);
        } else if (data.status === "rejected") {
          window.sessionStorage.removeItem(PENDING_MEMBERSHIP_ORDER_KEY);
          clearPaymentQuery();
          setProMessage(language === "vi" ? "Đơn Subscription đã hủy." : "Subscription order canceled.");
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
        setFeedback(kind === "membership" ? subscriptionApprovalMessage(data, language)
          : language === "vi" ? "Thanh toán thành công. Tài khoản đã được cập nhật." : "Payment successful. Your account has been updated.");
        if (kind === "membership") api("/api/membership/me").then((details) => setMembership(details.membership)).catch(() => {});
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
  const voucherTargetsMembership =
    appliedVoucher &&
    topupMode === "pro" &&
    appliedVoucher.appliesToMembership !== false &&
    Number(appliedVoucher.discountPercent || 0) > 0;
  const canBuyCredit = selectedPackage && finalPrice(selectedPackage) !== null && (language !== "en" || paypalEnabled) && finalPrice(selectedPackage) >= (currency === "USD" ? 0.01 : 1000);
  const canBuyPro = subscriptionCheckoutEnabled && selectedMembershipPlan && membershipFinalPrice(selectedMembershipPlan) !== null && (language !== "en" || paypalEnabled || membershipFinalPrice(selectedMembershipPlan) === 0);
  const isSubscription = topupMode === "pro";
  const selectedItem = isSubscription ? selectedMembershipPlan : selectedPackage;
  const selectedPrice = selectedItem ? isSubscription ? membershipFinalPrice(selectedItem) : finalPrice(selectedItem) : null;
  const selectedOriginalPrice = selectedItem ? isSubscription ? subscriptionPlanPrice(selectedItem, language) : priceBeforeVoucher(selectedItem) : null;
  const voucherApplies = isSubscription ? voucherTargetsMembership : selectedPackage && voucherAppliesToPackage(appliedVoucher, selectedPackage);
  const checkoutBusy = isSubscription ? proLoading : submitting;
  const checkoutAllowed = isSubscription ? canBuyPro : canBuyCredit;
  const catalogLoading = isSubscription ? plansLoading : packagesLoading;
  const paymentProviderLabel = isSubscription && selectedPrice === 0
    ? language === "vi" ? "Kích hoạt miễn phí" : "Free activation"
    : language === "en" ? "PayPal · USD" : "SePay · VND";

  function membershipFinalPrice(plan) {
    const original = subscriptionPlanPrice(plan, language);
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
      setProError(language === "vi" ? "Vui lòng đăng nhập trước khi mua Subscription." : "Please sign in before buying Subscription.");
      return;
    }
    if (!selectedMembershipPlan) {
      setProError(language === "vi" ? "Vui lòng chọn Subscription." : "Please select a Subscription plan.");
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
        setProMessage(subscriptionApprovalMessage(data, language, { free: true }));
        api("/api/membership/me").then((details) => setMembership(details.membership)).catch(() => {});
        return;
      }
      if (data.order?._id) {
        window.sessionStorage.setItem(PENDING_MEMBERSHIP_ORDER_KEY, data.order._id);
      }
      setProMessage(language === "vi" ? "Đang chuyển sang cổng thanh toán..." : "Redirecting to payment...");
      if (!submitPaymentCheckout(data.payment)) {
        setProMessage(language === "vi" ? "Đã tạo đơn Subscription. Vui lòng hoàn tất thanh toán." : "Subscription order created. Please complete payment.");
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
    if (voucherLoading || !voucher.trim() || checkoutBusy) return;
    setVoucherLoading(true);
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
      setVoucherMessage(data.message || (language === "vi" ? "Đã áp dụng voucher." : "Discount code applied."));
    } catch (err) {
      setVoucherError(err.message);
    } finally {
      setVoucherLoading(false);
    }
  }

  return (
    <div className="topupPage subscriptionPage">
      <header className="topupPageHeader">
        <div>
          <h1>{language === "vi" ? "Nạp tài khoản" : "Top up your account"}</h1>
          <p>{language === "vi" ? "Subscription cho nhu cầu thường xuyên. Credit cho từng lượt tải." : "Subscription for regular downloads. Credits for one-off purchases."}</p>
        </div>
        <a className="topupHistoryLink" href="/history"><History size={16} />{language === "vi" ? "Lịch sử giao dịch" : "Transaction history"}<ArrowRight size={14} /></a>
      </header>

      <div className="topupAccountStrip">
        <div><Wallet size={19} /><span>{language === "vi" ? "Số dư hiện tại" : "Current balance"}<strong>{Number(user?.credit || 0).toLocaleString(locale)} <small>Credit</small></strong></span></div>
        <div><Sparkles size={19} /><span>Subscription<strong>{membership?.active ? (membership.currentPeriod?.dailyDownloadLimit ?? membership.dailyDownloadLimit) + (language === "vi" ? " lượt/ngày" : " downloads/day") : "Free"}</strong></span></div>
        {membership?.active && <div><CheckCircle2 size={19} /><span>{language === "vi" ? "Gói hiện tại đến" : "Current plan until"}<strong>{subscriptionDateLabel(membership.currentPeriod?.endsAt || membership.proUntil, language, { exclusiveEnd: Boolean(membership.currentPeriod?.endsAt) })}</strong></span></div>}
      </div>

      <div className="topupModeTabs" role="tablist" aria-label={language === "vi" ? "Loại gói nạp" : "Package type"}>
        {["pro", "credit"].map((mode) => (
          <button key={mode} ref={(button) => { modeButtons.current[mode] = button; }}
            id={"topup-tab-" + mode} type="button" role="tab" aria-selected={topupMode === mode}
            aria-controls="topup-catalog" tabIndex={topupMode === mode ? 0 : -1}
            disabled={checkoutBusy || voucherLoading} onKeyDown={handleModeKeyDown} onClick={() => changeTopupMode(mode)}>
            {mode === "pro" ? <Sparkles size={18} /> : <Wallet size={18} />}
            {mode === "pro" ? "Subscription" : "Credit"}
          </button>
        ))}
      </div>

      <div className="topupLayout">
        <div className="topupCatalogColumn" id="topup-catalog" role="tabpanel" aria-labelledby={"topup-tab-" + topupMode} aria-busy={catalogLoading}>
          {isSubscription ? (
            <section className="topupCatalogSection">
              <header className="topupCatalogHeader">
                <h2>{language === "vi" ? "Tải Model & Scene mỗi ngày" : "Daily Model & Scene downloads"}</h2>
                <p>{language === "vi" ? "Model trừ 1 lượt · Scene trừ 5 lượt · Không trừ Credit" : "Model: 1 download · Scene: 5 downloads · No Credits spent"}</p>
              </header>
              <SubscriptionPlans plans={membershipPlans} period={subscriptionPeriod} language={language}
                paypalEnabled={paypalEnabled} checkoutEnabled={subscriptionCheckoutEnabled}
                selectedPlanId={selectedMembershipPlanId} getPrice={membershipFinalPrice} loading={plansLoading || checkoutBusy || voucherLoading}
                discountLabel={voucherTargetsMembership ? "Voucher " + appliedVoucher.code + ": -" + appliedVoucher.discountPercent + "%" : ""}
                onPeriodChange={(value) => {
                  setSubscriptionPeriod(value);
                  const selection = initialSubscriptionSelection(membershipPlans, "", value);
                  setSelectedMembershipPlanId(selection.planId);
                  updateTopupSelectionQuery({ planId: selection.planId }, selection.planId ? [] : ["planId"]);
                }}
                onSelect={(plan) => {
                  updateTopupSelectionQuery({ mode: "pro", planId: plan._id }, ["packageId"]);
                  setSelectedMembershipPlanId(plan._id); setProMessage(""); setProError("");
                }} />
              {!subscriptionCheckoutEnabled && <p className="topupFeedback" role="status">{language === "vi" ? "Tạm ngừng nhận đơn Subscription mới." : "New Subscription purchases are temporarily paused."}</p>}
              <SubscriptionSchedule membership={membership} language={language} />
            </section>
          ) : (
            <section className="topupCatalogSection">
              <header className="topupCatalogHeader">
                <h2>{language === "vi" ? "Credit cho từng lượt tải" : "Credits for individual downloads"}</h2>
                <p>{language === "vi"
                  ? "Getlink theo giá model · Model " + marketplacePrices.model + " Credit · Scene " + marketplacePrices.scene + " Credit"
                  : "Getlink at the model price · Model " + marketplacePrices.model + " Credits · Scene " + marketplacePrices.scene + " Credits"}</p>
              </header>
              <div className="topupCreditPlanGrid">
                {packages.map((item) => {
                  const selected = String(selectedPackageId) === String(item._id);
                  return (
                    <article className={"topupCreditPlan" + (selected ? " isSelected" : "")} key={item._id}>
                      <div className="topupCreditPlanHeading">
                        <h3>{item.name || t.defaultPackageName}</h3>
                        {selected && <CheckCircle2 size={18} aria-label={language === "vi" ? "Đang chọn" : "Selected"} />}
                      </div>
                      {item.badge && <span className="badge success">{item.badge}</span>}
                      <p className="topupCreditAmount"><strong>{finalCredit(item).toLocaleString(locale)}</strong> Credit</p>
                      <div className="topupCreditPlanPrice">
                        <strong>{money(finalPrice(item))}</strong>
                        {hasSale(item) && <del>{money(item.price)}</del>}
                      </div>
                      {Number(item.maxTopupsPerUser || 0) > 0 && <small>{language === "vi" ? "Tối đa " + item.maxTopupsPerUser + " lần/tài khoản" : "Max " + item.maxTopupsPerUser + " purchases/account"}</small>}
                      {item.features?.length > 0 && (
                        <ul className="subscriptionPlanBenefits">{item.features.map((feature, index) => <li key={index}><Check size={14} aria-hidden="true" /><span>{feature}</span></li>)}</ul>
                      )}
                      {finalPrice(item) === null && <small className="subscriptionUnavailable">{language === "vi" ? "Gói chưa có giá để mua." : "USD price is not available yet."}</small>}
                      <button type="button" className={selected ? "primaryButton" : "googleButton"} aria-pressed={selected}
                        disabled={checkoutBusy || voucherLoading} onClick={() => selectPackage(item)}>
                        {selected ? <Check size={16} /> : <Wallet size={16} />}
                        {language === "vi" ? selected ? "Đang chọn" : "Chọn gói" : selected ? "Selected" : "Select package"}
                      </button>
                    </article>
                  );
                })}
              </div>
              {!packages.length && <p className="subscriptionEmpty" role="status">{packagesLoading ? language === "vi" ? "Đang tải gói Credit..." : "Loading Credit packages..." : language === "vi" ? "Chưa có gói Credit đang bán." : "No Credit packages are available yet."}</p>}
              <p className="topupCatalogNote">{language === "vi" ? "Credit dùng cho Getlink và tải lẻ Model/Scene, không kích hoạt Subscription." : "Credits cover Getlink and one-off Model/Scene downloads. They do not activate Subscription."}</p>
            </section>
          )}

          {!isSubscription && lastPaidPayment && (
            <section className="topupPaymentResult" role="status">
              <CheckCircle2 size={22} />
              <div><h3>{t.paymentDone}</h3><strong>+{Number(lastPaidPayment.credit || 0).toLocaleString(locale)} Credit</strong>
                <p>{language === "vi" ? "Mã giao dịch: " : "Transaction: "}{lastPaidPayment.paymentCode || lastPaidPayment.paypalOrderId || lastPaidPayment._id}</p></div>
            </section>
          )}
          {!isSubscription && payment && (
            <section className="topupPaymentDetails">
              <h3>{t.paymentInfo}</h3>
              <dl className="topupPaymentRows">
                <div><dt>{t.amount}</dt><dd>{money(payment.amount, locale, payment.currency || "VND")}</dd>
                  <button className="topupIconButton" type="button" title={t.copy} aria-label={t.copy + " " + t.amount} onClick={() => copyText(payment.amount, "amount")}>{copied === "amount" ? <Check size={16} /> : <Copy size={16} />}</button></div>
                {payment.voucherCode && <div><dt>Voucher</dt><dd>{payment.voucherCode}</dd><span>{Number(payment.discountAmount || 0) > 0 ? "-" + money(payment.discountAmount, locale, payment.currency || "VND") : "+" + Number(payment.voucherCreditBonus || 0) + " Credit"}</span></div>}
                <div><dt>{t.orderCode}</dt><dd>{payment.paymentCode || payment.paypalOrderId || payment._id}</dd>
                  <button className="topupIconButton" type="button" title={t.copy} aria-label={t.copy + " " + t.orderCode} onClick={() => copyText(payment.paymentCode || payment.paypalOrderId || payment._id, "code")}>{copied === "code" ? <Check size={16} /> : <Copy size={16} />}</button></div>
                <div><dt>{payment.gatewayProvider === "paypal" ? "PayPal" : t.paymentLabel}</dt><dd>{payment.status === "approved" ? t.credited : t.waitingPayment}</dd></div>
              </dl>
              <p className="topupCatalogNote">{t.creditAutoAfterConfirm}</p>
            </section>
          )}
        </div>

        <aside className="topupOrderColumn" aria-label={language === "vi" ? "Đơn thanh toán" : "Order summary"}>
          <div className="topupCheckoutBox topupOrderSummary">
            <header className="topupOrderHeading"><h2>{language === "vi" ? "Đơn của bạn" : "Your order"}</h2><ShieldCheck size={19} /></header>
            <div className="topupSelectedItem">
              <span>{isSubscription ? "Subscription" : "Credit"}</span>
              <strong>{selectedItem?.name || (language === "vi" ? "Chưa chọn gói" : "No package selected")}</strong>
              {selectedItem && (isSubscription
                ? <p>{subscriptionCheckoutDescription(selectedItem, membership, language)}</p>
                : <p>{language === "vi" ? "Nhận " : "Receive "}<b>{finalCredit(selectedItem).toLocaleString(locale)} Credit</b></p>)}
            </div>
            <div className="topupVoucherPanel">
              <form className="topupVoucherForm" onSubmit={applyVoucher}>
                <label htmlFor="topup-voucher"><Gift size={16} />{language === "vi" ? "Mã giảm giá" : "Discount code"}</label>
                <div className="topupVoucherInputRow">
                  <input id="topup-voucher" value={voucher} onChange={(event) => setVoucher(event.target.value)}
                    placeholder={t.voucherPlaceholder} autoComplete="off" maxLength={64} disabled={checkoutBusy || voucherLoading} />
                  <button type="submit" disabled={!voucher.trim() || !selectedItem || checkoutBusy || voucherLoading}>
                    {voucherLoading ? <Loader2 size={16} className="topupSpinner" /> : null}{t.apply}
                  </button>
                </div>
              </form>
              {appliedVoucher && (
                <div className="topupAppliedVoucher"><Gift size={14} /><strong>{appliedVoucher.code}</strong>
                  <span>{voucherApplies ? Number(appliedVoucher.discountPercent || 0) > 0 ? "-" + appliedVoucher.discountPercent + "%" : "+" + Number(appliedVoucher.creditBonus || 0) + " Credit" : t.voucherNotApplicable}</span>
                  <button className="topupIconButton" type="button" title={language === "vi" ? "Bỏ voucher" : "Remove voucher"} aria-label={language === "vi" ? "Bỏ voucher" : "Remove voucher"}
                    disabled={checkoutBusy || voucherLoading} onClick={() => { setAppliedVoucher(null); setVoucherMessage(""); setVoucherError(""); }}><X size={15} /></button>
                </div>
              )}
              {voucherMessage && <p className="topupFeedback success" role="status">{voucherMessage}</p>}
              {voucherError && <p className="topupFeedback error" role="alert">{voucherError}</p>}
            </div>
            <dl className="topupOrderTotals">
              <div><dt>{language === "vi" ? "Giá gói" : "Package price"}</dt><dd>{selectedItem ? money(selectedOriginalPrice) : "-"}</dd></div>
              {selectedPrice !== null && selectedOriginalPrice > selectedPrice && <div className="topupDiscountRow"><dt>{language === "vi" ? "Giảm giá" : "Discount"}</dt><dd>-{money(selectedOriginalPrice - selectedPrice)}</dd></div>}
              <div className="topupOrderTotal"><dt>{language === "vi" ? "Tổng thanh toán" : "Total"}</dt><dd>{selectedItem ? money(selectedPrice) : "-"}</dd></div>
            </dl>
            <div className="topupPaymentProvider"><CreditCard size={16} /><span>{paymentProviderLabel}</span></div>
            <button className="primaryButton topupPayButton" type="button" disabled={!checkoutAllowed || checkoutBusy || voucherLoading}
              onClick={isSubscription ? checkoutMembership : topup}>
              {checkoutBusy ? <Loader2 size={17} className="topupSpinner" /> : <ArrowRight size={17} />}
              {checkoutBusy ? t.redirectingPayment : selectedItem && selectedPrice === 0 && isSubscription
                ? language === "vi" ? "Nhận gói miễn phí" : "Get free plan"
                : language === "en" ? "Pay with PayPal" : isSubscription ? "Mua Subscription" : "Nạp Credit"}
            </button>
            {selectedItem && selectedPrice === null && <p className="topupFeedback" role="status">{language === "vi" ? "Gói chưa có giá để mua." : "USD price is not available for this package yet."}</p>}
            {selectedItem && selectedPrice !== null && selectedPrice > 0 && language === "en" && !paypalEnabled && <p className="topupFeedback" role="status">PayPal checkout is not available yet.</p>}
            {(isSubscription ? proMessage : message) && <p className="topupFeedback success" role="status">{isSubscription ? proMessage : message}</p>}
            {(isSubscription ? proError : error) && <p className="topupFeedback error" role="alert">{isSubscription ? proError : error}</p>}
          </div>
          <p className="topupOrderFootnote"><ShieldCheck size={15} />{language === "vi" ? "Quyền lợi được cập nhật sau khi xác nhận thanh toán." : "Benefits are updated after payment is confirmed."}</p>
        </aside>
      </div>
    </div>
  );
}
