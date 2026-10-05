# PayPal implementation verification

Date: 2026-10-05. No production deployment or real payments were performed.

## Results

- `npm run check`: passed lint, all 369 backend tests, frontend build and release artifact scan.
- `backend/test/paypal-payment.test.js`: 34 regression tests using memory fixtures and mocked PayPal APIs.
- `node backend/scripts/qa-paypal.js qa-report/paypal-dist qa-report/paypal-ui`: passed four combinations of VI/EN, light/dark, 390px mobile and 1440px desktop.
- UI coverage: independent USD/VND pricing, unavailable USD prices, disabled gateway, free Trial, redirect provider, callback recovery without sessionStorage, account balance, homepage prices, admin Credit/Pro USD editing and currency-specific transaction history.
- PayPal reconciliation details wrap within mobile transaction cards; long capture/dispute values are not clipped.
- `npm run qa:smoke --prefix backend -- ../qa-report/paypal-dist ../qa-report/paypal-smoke/screenshots ../qa-report/paypal-smoke/smoke.json`: passed seven routes, two viewports, account balance updates and configured Credit copy with no external failures.
- Smoke load: 300 requests at concurrency 20; local memory-fixture p95 17.87ms. These figures are not production or PayPal network latency measurements.
- `git diff --check`: passed.

## Payment Regression Coverage

Tests cover frozen prices and benefits, missing USD prices, free Trial, shared purchase/voucher limits, one-cent Credit minimum, stacked Pro and daily quota add-ons, ownership, CSRF, rate limiting, forged/duplicate webhooks, merchant/currency/amount mismatch, simultaneous callback/webhook capture, PENDING/declined captures, lost responses, benefit-write failure, closed browser recovery, disabled-gateway reconciliation, refunds/disputes without automatic revocation and legacy SePay isolation.

Captured payments are retained for reconciliation. Refunds arriving before fulfillment require manual review rather than a second capture or automatic grant.

## Remaining Release Gate

Real Sandbox integration has not been run: Business REST app, webhook and merchant configuration are still required. Validate actual capture payloads, fees, webhook delivery, account events and Telegram delivery in Sandbox before enabling Live. Atlas transaction/restart integration must also be exercised there; memory tests do not replace it.

The generic smoke metric `completedGetlinkBalanceReplay` is false in this fixture. No claim is made that this specific Getlink replay scenario was tested in that browser run.

`PAYPAL_ENABLED` remains false by default. No commit, push, VPS deployment or Live activation was performed for this implementation.

Operations and rollback: [PayPal payments runbook](../docs/PAYPAL_PAYMENTS_RUNBOOK.md).
