import React from "react";
import { Coins } from "lucide-react";

export function CoinIcon({ size = 15, className = "" }) {
  return (
    <Coins
      aria-hidden="true"
      className={`coinIcon ${className}`.trim()}
      size={size}
    />
  );
}

export default function CoinAmount({ value, prefix = "", className = "" }) {
  return (
    <span className={`coinAmount ${className}`.trim()}>
      {prefix && <span>{prefix}</span>}
      <span>{value}</span>
      <CoinIcon />
    </span>
  );
}
