import React from "react";
import CoinAmount, { CoinIcon } from "./CoinAmount.jsx";

export default function CreditCard({ user }) {
  return (
    <section className="panel creditPanel">
      <span><CoinIcon size={14} /> Balance</span>
      <strong><CoinAmount value={user.credit} /></strong>
    </section>
  );
}
