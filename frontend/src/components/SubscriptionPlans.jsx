import React, { useId } from "react";
import { Check, CheckCircle2, CreditCard } from "lucide-react";
import SubscriptionPeriodTabs from "./SubscriptionPeriodTabs.jsx";
import {
  membershipBenefitLabels,
  membershipDurationLabel,
  subscriptionPlanPrice,
  subscriptionPlansForPeriod,
} from "../utils/membershipPresentation.js";
import { checkoutCurrency, formatPaymentMoney } from "../utils/paymentPresentation.js";
import "./subscription.css";

export default function SubscriptionPlans({
  plans = [], period = "month", onPeriodChange, selectedPlanId = "", onSelect,
  hrefForPlan, language = "vi", paypalEnabled = false, checkoutEnabled = true, getPrice, discountLabel = "", loading = false, compact = false,
}) {
  const panelId = useId();
  const visiblePlans = subscriptionPlansForPeriod(plans, period);
  const locale = language === "vi" ? "vi-VN" : "en-US";
  return (
    <div className="subscriptionCatalog">
      <div className="subscriptionCatalogHeading">
        <SubscriptionPeriodTabs value={period} onChange={onPeriodChange} language={language} panelId={panelId} disabled={loading} />
        <p>{language === "vi" ? "Thanh toán từng lần, không tự động gia hạn" : "One-time payment, no automatic renewal"}</p>
      </div>
      <div id={panelId} role="tabpanel" aria-label={language === "vi" ? "Các gói Subscription" : "Subscription plans"} aria-busy={loading}>
        <div className="subscriptionPlanGrid" style={{ "--subscription-columns": Math.min(visiblePlans.length || 1, 5) }}>
          {visiblePlans.map((plan) => {
            const originalPrice = subscriptionPlanPrice(plan, language);
            const price = originalPrice === null ? null : getPrice ? getPrice(plan) : originalPrice;
            const selected = String(selectedPlanId) === String(plan._id);
            const available = checkoutEnabled && price !== null && (language !== "en" || price === 0 || paypalEnabled);
            return (
              <article key={plan._id || plan.code} className={`subscriptionPlanCard${selected ? " isSelected" : ""}`}>
                <div className="subscriptionPlanHeading">
                  {plan.badge && <span className="badge success">{plan.badge}</span>}
                  {selected && <CheckCircle2 size={18} className="subscriptionSelectionIcon" aria-label={language === "vi" ? "Đang chọn" : "Selected"} />}
                  <h3>{plan.name}</h3>
                </div>
                <strong className={`subscriptionPlanPrice${price === null ? " unavailable" : ""}`}>
                  {formatPaymentMoney(price, checkoutCurrency(language), locale)}
                </strong>
                {discountLabel && originalPrice !== null && price < originalPrice && <small className="subscriptionDiscount">{discountLabel}</small>}
                <p className="subscriptionPlanQuota">
                  <strong>{Number(plan.dailyDownloadLimit || 0).toLocaleString(locale)}</strong>
                  <span>{language === "vi" ? "lượt/ngày" : "downloads/day"}</span>
                </p>
                <p className="subscriptionPlanDuration">{membershipDurationLabel(plan, language)}</p>
                {Number(plan.maxPurchasesPerUser || 0) > 0 && (
                  <small className="subscriptionPurchaseLimit">
                    {language === "vi"
                      ? `Tối đa ${plan.maxPurchasesPerUser} lần/tài khoản`
                      : `Max ${plan.maxPurchasesPerUser} purchases/account`}
                  </small>
                )}
                {compact ? (
                  <details className="subscriptionBenefitsDisclosure">
                    <summary>{language === "vi" ? "Quyền lợi gói" : "Plan benefits"}</summary>
                    <ul className="subscriptionPlanBenefits">
                      {membershipBenefitLabels(plan, language).map((feature) => <li key={feature}><Check size={14} aria-hidden="true" /><span>{feature}</span></li>)}
                    </ul>
                  </details>
                ) : (
                  <ul className="subscriptionPlanBenefits">
                    {membershipBenefitLabels(plan, language).map((feature) => <li key={feature}><Check size={14} aria-hidden="true" /><span>{feature}</span></li>)}
                  </ul>
                )}
                <div className="subscriptionPlanAction">
                  {!available && (
                    <small className="subscriptionUnavailable">
                      {!checkoutEnabled ? language === "vi" ? "Tạm ngừng nhận đơn mới." : "New purchases are temporarily paused." : price === null
                        ? language === "vi" ? "Gói chưa có giá để mua." : "Price is not available for this plan yet."
                        : "PayPal checkout is not available yet."}
                    </small>
                  )}
                  {onSelect ? (
                    <button type="button" className={selected ? "primaryButton" : "googleButton"} aria-pressed={selected} disabled={loading} onClick={() => onSelect(plan)}>
                      {selected ? <Check size={16} /> : <CreditCard size={16} />}
                      {language === "vi" ? selected ? "Đang chọn" : "Chọn gói" : selected ? "Selected" : "Select plan"}
                    </button>
                  ) : available ? (
                    <a className="primaryButton" href={hrefForPlan?.(plan)}>
                      <CreditCard size={16} />
                      {language === "en" && price > 0 ? "Pay with PayPal" : language === "vi" ? price === 0 ? "Nhận gói miễn phí" : "Mua Subscription" : price === 0 ? "Get free plan" : "Buy Subscription"}
                    </a>
                  ) : <button type="button" className="googleButton" disabled>{language === "vi" ? "Chưa mở bán" : "Not available"}</button>}
                </div>
              </article>
            );
          })}
        </div>
        {!visiblePlans.length && <p className="subscriptionEmpty" role="status">{loading
          ? language === "vi" ? "Đang tải Subscription..." : "Loading Subscription plans..."
          : language === "vi" ? "Chưa có gói đang bán trong kỳ này." : "No plans are on sale for this period yet."}</p>}
      </div>
    </div>
  );
}
