import React, { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard, Sparkles } from "lucide-react";
import { api } from "../api.js";
import { initialSubscriptionSelection, subscriptionApprovalMessage, subscriptionCheckoutDescription, subscriptionPlanPrice } from "../utils/membershipPresentation.js";
import { checkoutCurrency, formatPaymentMoney, submitPaymentCheckout } from "../utils/paymentPresentation.js";
import SubscriptionPlans from "../components/SubscriptionPlans.jsx";
import SubscriptionSchedule from "../components/SubscriptionSchedule.jsx";

const PENDING_MEMBERSHIP_ORDER_KEY = "pendingMembershipOrderId";

function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `membership-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

export default function Membership({ user, onUserChange, language = "vi" }) {
  const locale = language === "vi" ? "vi-VN" : "en-US";
  const [paypalEnabled, setPaypalEnabled] = useState(false);
  const money = (plan) => formatPaymentMoney(subscriptionPlanPrice(plan, language), checkoutCurrency(language), locale);
  const [plans, setPlans] = useState([]);
  const [membership, setMembership] = useState(null);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [period, setPeriod] = useState("month");
  const [checkoutEnabled, setCheckoutEnabled] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestKeyRef = useRef("");

  const loadPlans = useCallback(async () => {
    const data = await api("/api/membership/plans");
    setPaypalEnabled(data.payments?.paypal?.enabled === true);
    setPlans(data.plans || []);
    setCheckoutEnabled(data.checkoutEnabled !== false);
    const selection = initialSubscriptionSelection(data.plans, new URLSearchParams(window.location.search).get("planId"));
    setPeriod(selection.period);
    setSelectedPlanId(selection.planId);
  }, []);

  const loadMe = useCallback(async () => {
    if (!user) return;
    const data = await api("/api/membership/me");
    setMembership(data.membership || null);
  }, [user]);

  useEffect(() => {
    loadPlans().catch((err) => setError(err.message));
  }, [loadPlans]);

  useEffect(() => {
    loadMe().catch(() => {});
  }, [loadMe]);

  useEffect(() => {
    const paymentStatus = new URLSearchParams(window.location.search).get("payment");
    const pendingOrderId = window.sessionStorage.getItem(PENDING_MEMBERSHIP_ORDER_KEY);
    if (!paymentStatus || !pendingOrderId || !user) return undefined;
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      try {
        const data = await api(`/api/membership/orders/${pendingOrderId}/status`);
        if (data.status === "approved") {
          window.sessionStorage.removeItem(PENDING_MEMBERSHIP_ORDER_KEY);
          setMembership(data.membership);
          onUserChange?.((current) => current ? {
            ...current,
            proUntil: data.membership?.proUntil,
            isPro: data.membership?.active,
            proDailyDownloadLimit: data.membership?.dailyDownloadLimit,
            subscriptionCurrentPeriod: data.membership?.currentPeriod,
          } : current);
          setMessage(subscriptionApprovalMessage(data, language));
          loadMe().catch(() => {});
          window.clearInterval(timer);
        }
        if (data.status === "rejected") {
          window.sessionStorage.removeItem(PENDING_MEMBERSHIP_ORDER_KEY);
          setMessage(language === "vi" ? "Đơn Subscription đã hủy." : "Subscription order canceled.");
          window.clearInterval(timer);
        }
      } catch {
        // Keep polling while the gateway redirects back.
      }
      if (attempts >= 20) window.clearInterval(timer);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [user, onUserChange, language, loadMe]);

  async function checkout() {
    if (loading || requestKeyRef.current) return;
    if (!user) {
      setError(language === "vi" ? "Vui lòng đăng nhập trước khi mua Subscription." : "Please sign in before buying Subscription.");
      return;
    }
    if (!selectedPlanId) return;
    setLoading(true);
    requestKeyRef.current = createIdempotencyKey();
    setError("");
    setMessage("");
    try {
      const data = await api("/api/membership/checkout", {
        method: "POST",
        headers: { "Idempotency-Key": requestKeyRef.current },
        body: JSON.stringify({ planId: selectedPlanId, paymentProvider: language === "en" ? "paypal" : "sepay" }),
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
        setMessage(subscriptionApprovalMessage(data, language, { free: true }));
        loadMe().catch(() => {});
        return;
      }
      window.sessionStorage.setItem(PENDING_MEMBERSHIP_ORDER_KEY, data.order._id);
      setMessage(language === "vi" ? "Đang chuyển sang cổng thanh toán..." : "Redirecting to payment...");
      if (!submitPaymentCheckout(data.payment)) {
        setMessage(language === "vi" ? "Đã tạo đơn Subscription. Vui lòng hoàn tất thanh toán." : "Subscription order created.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      requestKeyRef.current = "";
      setLoading(false);
    }
  }

  const selectedPlan = plans.find((plan) => String(plan._id) === String(selectedPlanId));
  const selectedPrice = selectedPlan ? subscriptionPlanPrice(selectedPlan, language) : null;
  const canBuy = checkoutEnabled && selectedPrice !== null && (language !== "en" || selectedPrice === 0 || paypalEnabled);

  return (
    <div className="stack subscriptionPage">
      <section className="membershipHero">
        <div>
          <p className="eyebrowSignal">3DIPL MEMBER</p>
          <h2>Subscription</h2>
          <p>
            {language === "vi"
              ? "Subscription mở Model/Scene Pro: Model trừ 1 lượt, Scene trừ 5 lượt; Credit được giữ riêng."
              : "Subscription unlocks Pro Models/Scenes: Models cost 1 download, Scenes cost 5; Credits remain separate."}
          </p>
          {membership?.active && (
            <span className="badge success">
              {language === "vi" ? "Đang Pro đến" : "Pro until"} {new Date(membership.proUntil).toLocaleString(locale)}
            </span>
          )}
        </div>
        <Sparkles size={42} />
      </section>

      <SubscriptionSchedule membership={membership} language={language} />
      <SubscriptionPlans plans={plans} period={period} language={language} paypalEnabled={paypalEnabled} checkoutEnabled={checkoutEnabled}
        selectedPlanId={selectedPlanId} onSelect={(plan) => setSelectedPlanId(plan._id)}
        onPeriodChange={(value) => { setPeriod(value); setSelectedPlanId(initialSubscriptionSelection(plans, "", value).planId); }} />

      <section className="panel topupCheckoutBox">
        <div>
          <span>{language === "vi" ? "Subscription đang chọn" : "Selected Subscription"}</span>
          <strong>{selectedPlan?.name || "-"}</strong>
          <p>{selectedPlan ? money(selectedPlan) : ""}</p>
          <p>{subscriptionCheckoutDescription(selectedPlan, membership, language)}</p>
        </div>
        <button className="primaryButton" disabled={loading || !canBuy} onClick={checkout}>
          <CreditCard size={18} />
          {language === "vi" ? "Mua Subscription" : selectedPrice > 0 ? "Pay with PayPal" : "Get Subscription"}
        </button>
      </section>
      {language === "en" && selectedPlan && !canBuy && <p className="muted">{selectedPrice === null ? "USD price is not available for this plan yet." : "PayPal checkout is not available yet."}</p>}
      {message && <p className="success">{message}</p>}
      {!checkoutEnabled && <p role="status">{language === "vi" ? "Tạm ngừng nhận đơn Subscription mới." : "New Subscription purchases are temporarily paused."}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
