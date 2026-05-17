import React from "react";

export default function CreditCard({ user }) {
  return (
    <section className="panel creditPanel">
      <span>Credit balance</span>
      <strong>{user.credit}</strong>
    </section>
  );
}
