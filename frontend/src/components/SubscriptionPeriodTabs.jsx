import React, { useId, useRef } from "react";
import { CalendarDays, CalendarRange, Sun } from "lucide-react";
import { SUBSCRIPTION_PERIODS, subscriptionPeriodLabel } from "../utils/membershipPresentation.js";
import "./subscription.css";

const PERIOD_ICONS = { day: Sun, month: CalendarDays, year: CalendarRange };

export default function SubscriptionPeriodTabs({ value = "month", onChange, language = "vi", panelId, disabled = false }) {
  const id = useId();
  const buttons = useRef([]);

  function handleKeyDown(event, index) {
    if (disabled) return;
    let nextIndex;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % SUBSCRIPTION_PERIODS.length;
    else if (event.key === "ArrowLeft") nextIndex = (index + SUBSCRIPTION_PERIODS.length - 1) % SUBSCRIPTION_PERIODS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = SUBSCRIPTION_PERIODS.length - 1;
    else return;
    event.preventDefault();
    onChange(SUBSCRIPTION_PERIODS[nextIndex]);
    buttons.current[nextIndex]?.focus();
  }

  return (
    <div className="subscriptionPeriodTabs" role="tablist" aria-label={language === "vi" ? "Kỳ Subscription" : "Subscription period"}>
      {SUBSCRIPTION_PERIODS.map((period, index) => {
        const Icon = PERIOD_ICONS[period];
        return (
          <button
            key={period}
            ref={(button) => { buttons.current[index] = button; }}
            type="button"
            disabled={disabled}
            id={`${id}-${period}`}
            role="tab"
            aria-selected={value === period}
            aria-controls={panelId}
            tabIndex={value === period ? 0 : -1}
            onClick={() => onChange(period)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <Icon size={17} aria-hidden="true" />
            {subscriptionPeriodLabel(period, language)}
          </button>
        );
      })}
    </div>
  );
}
