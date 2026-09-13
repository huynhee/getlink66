import { useEffect, useState } from "react";
import { api } from "../api.js";
import { marketplacePriceLabels } from "./marketplacePriceLabels.js";

export function useMarketplacePrices() {
  const [prices, setPrices] = useState(() => marketplacePriceLabels());
  useEffect(() => {
    let active = true;
    let controller = null;
    async function refresh() {
      if (!active || controller || document.visibilityState === "hidden") return;
      controller = new AbortController();
      const request = controller;
      const timeout = window.setTimeout(() => request.abort(), 10000);
      try {
        const data = await api("/api/settings", { signal: request.signal, cache: "no-store" });
        if (active) setPrices(marketplacePriceLabels(data.settings));
      } catch {
        // Do not advertise a default price when the current price is unavailable.
        if (active) setPrices(marketplacePriceLabels());
      } finally {
        window.clearTimeout(timeout);
        controller = null;
      }
    }
    refresh();
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return prices;
}
