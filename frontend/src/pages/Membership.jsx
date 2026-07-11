import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, CreditCard, Sparkles } from "lucide-react";
import { api } from "../api.js";

const PENDING_MEMBERSHIP_ORDER_KEY = "pendingMembershipOrderId";

function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `membership-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

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

function money(value, locale) {
  return `${Number(value || 0).toLocaleString(locale)}đ`;
}

export default function Membership({ user, onUserChange, language = "vi" }) {
  const locale = language === "vi" ? "vi-VN" : "en-US";
  const [plans, setPlans] = useState([]);
  const [membership, setMembership] = useState(null);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestKeyRef = useRef("");

  const loadPlans = useCallback(async () => {
    const data = await api("/api/membership/plans");
    setPlans(data.plans || []);
    setSelectedPlanId((current) => current || data.plans?.[0]?._id || "");
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
          onUserChange?.({ ...user, proUntil: data.membership?.proUntil, isPro: data.membership?.active });
          setMessage(language === "vi" ? "Đã kích hoạt gói Pro." : "Pro membership activated.");
          window.clearInterval(timer);
        }
        if (data.status === "rejected") {
          window.sessionStorage.removeItem(PENDING_MEMBERSHIP_ORDER_KEY);
          setMessage(language === "vi" ? "Đơn Pro đã hủy." : "Membership order canceled.");
          window.clearInterval(timer);
        }
      } catch {
        // Keep polling while the gateway redirects back.
      }
      if (attempts >= 20) window.clearInterval(timer);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [user, onUserChange, language]);

  async function checkout() {
    if (loading || requestKeyRef.current) return;
    if (!user) {
      setError(language === "vi" ? "Vui lòng đăng nhập trước khi mua Pro." : "Please sign in before buying Pro.");
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
        body: JSON.stringify({ planId: selectedPlanId }),
      });
      window.sessionStorage.setItem(PENDING_MEMBERSHIP_ORDER_KEY, data.order._id);
      setMessage(language === "vi" ? "Đang chuyển sang cổng thanh toán..." : "Redirecting to payment...");
      if (!submitPaymentCheckout(data.payment)) {
        setMessage(language === "vi" ? "Đã tạo đơn Pro. Vui lòng hoàn tất thanh toán." : "Membership order created.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      requestKeyRef.current = "";
      setLoading(false);
    }
  }

  const selectedPlan = plans.find((plan) => String(plan._id) === String(selectedPlanId));

  return (
    <div className="stack">
      <section className="panel membershipHero">
        <div>
          <p className="eyebrowSignal">3DIPL MEMBER</p>
          <h2>{language === "vi" ? "Nâng cấp Pro" : "Upgrade to Pro"}</h2>
          <p>
            {language === "vi"
              ? "Pro dùng 100 lượt tải mỗi ngày, tải nhanh, mở model Pro và không cộng lẫn với credit."
              : "Pro gives 100 downloads per day, fast access, Pro models, and stays separate from credit."}
          </p>
          {membership?.active && (
            <span className="badge success">
              {language === "vi" ? "Đang Pro đến" : "Pro until"} {new Date(membership.proUntil).toLocaleString(locale)}
            </span>
          )}
        </div>
        <Sparkles size={42} />
      </section>

      <section className="membershipPlans">
        {plans.map((plan) => (
          <button
            key={plan._id}
            type="button"
            className={`membershipPlanCard panel ${selectedPlanId === plan._id ? "selectedPackage" : ""}`}
            onClick={() => setSelectedPlanId(plan._id)}
          >
            {plan.badge && <span className="badge success">{plan.badge}</span>}
            <h3>{plan.name}</h3>
            <strong>{money(plan.price, locale)}</strong>
            <span>{plan.durationDays} days · {plan.dailyDownloadLimit}/day</span>
            <ul>
              {(plan.features || []).map((feature) => (
                <li key={feature}><Check size={14} /> {feature}</li>
              ))}
            </ul>
          </button>
        ))}
      </section>

      <section className="panel topupCheckoutBox">
        <div>
          <span>{language === "vi" ? "Gói Pro đang chọn" : "Selected Pro plan"}</span>
          <strong>{selectedPlan?.name || "-"}</strong>
          <p>{selectedPlan ? money(selectedPlan.price, locale) : ""}</p>
        </div>
        <button className="primaryButton" disabled={loading || !selectedPlan} onClick={checkout}>
          <CreditCard size={18} />
          {language === "vi" ? "Mua Pro" : "Buy Pro"}
        </button>
      </section>
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
