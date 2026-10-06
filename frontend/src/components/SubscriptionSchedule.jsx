import React from "react";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { subscriptionDateLabel, subscriptionPeriodLabel } from "../utils/membershipPresentation.js";
import "./subscription.css";

export default function SubscriptionSchedule({ membership, language = "vi" }) {
  if (!membership) return null;
  const current = membership.currentPeriod;
  const upcoming = membership.upcomingPeriods || [];
  if (!membership.active && !current && !upcoming.length) return null;
  return (
    <section className="subscriptionSchedule" aria-label={language === "vi" ? "Lịch Subscription" : "Subscription schedule"}>
      <div className="subscriptionScheduleHeading">
        <h3><CalendarClock size={18} /> {language === "vi" ? "Lịch Subscription" : "Subscription schedule"}</h3>
        <small>{language === "vi" ? "Giờ Việt Nam (UTC+7)" : "Vietnam time (UTC+7)"}</small>
      </div>
      {(current || membership.active) && (
        <div className="subscriptionPeriodRow isCurrent">
          <div className="subscriptionPeriodIdentity">
            <span className="subscriptionPeriodStatus"><CheckCircle2 size={14} /> {language === "vi" ? "Đang có hiệu lực" : "Active now"}</span>
            <strong>{current?.planName || "Subscription"}</strong>
          </div>
          <span className="subscriptionPeriodQuota">{current?.dailyDownloadLimit ?? membership.dailyDownloadLimit} {language === "vi" ? "lượt/ngày" : "downloads/day"}</span>
          <span className="subscriptionPeriodDates">{language === "vi" ? "Đến" : "Until"} {subscriptionDateLabel(current?.endsAt || membership.proUntil, language, { exclusiveEnd: Boolean(current?.endsAt) })}</span>
        </div>
      )}
      {upcoming.map((period, index) => (
        <div className="subscriptionPeriodRow isUpcoming" key={period._id || period.id || `${period.startsAt}-${index}`}>
          <div className="subscriptionPeriodIdentity">
            <span className="subscriptionPeriodStatus"><CalendarClock size={14} /> {language === "vi" ? "Đã thanh toán, chờ bắt đầu" : "Paid, waiting to start"}</span>
            <strong>{period.planName || subscriptionPeriodLabel(period.billingPeriod, language)}</strong>
          </div>
          <span className="subscriptionPeriodQuota">{period.dailyDownloadLimit} {language === "vi" ? "lượt/ngày" : "downloads/day"}</span>
          <span className="subscriptionPeriodDates">{subscriptionDateLabel(period.startsAt, language)}<span aria-hidden="true"> → </span>{subscriptionDateLabel(period.endsAt, language, { exclusiveEnd: true })}</span>
        </div>
      ))}
    </section>
  );
}
