# Subscription Calendar V2

## Data and compatibility

Subscription is the package name; resource Free/Pro access and existing URLs,
`mode=pro`, payment providers and download pricing are unchanged. Purchases are
one-time payments, not recurring subscriptions. VI uses SePay/VND; EN uses
PayPal/USD. Missing prices are null, not free. Only explicit zero is free.

Core Atlas owns `SubscriptionPeriod` and the User projection. Periods use an
exclusive `endsAt`. New month/year periods append in approval order. Purchase
day is day one; duration is 30/365 calendar days by default, ending at Vietnam
midnight. Existing rights retain their exact expiry and quota. Day plans and
referral bonuses never extend the monthly/yearly queue. Downloads consume
1/5 quota units for Model/Scene, with no carry-over at Vietnam midnight.

The worker runs every 30 seconds. Account and download endpoints also reconcile
due periods. `proUntil` is the end of continuous coverage and
`proDailyDownloadLimit` is the current period's quota. Current/queued snapshots
are returned by `/api/membership/me`. Paid order snapshots never change.

Core referral quota grants retry onto a separate VPS idempotency collection;
existing daily paid add-on grant indexes are not replaced. A failed VPS write
does not undo a paid order or award credits a second time.

## Deployment and reviewed migration

There is one selling catalog: every enabled, non-archived plan with a configured
VND price is available, regardless of historical `catalogVersion`. Deploying
this change does not enable disabled plans or alter prices. No migration or
environment change is required to unify catalog availability. All new orders
use calendar policy V2; existing orders retain their original policy snapshots.
No production database is modified by tests. Use a maintenance/change window
if the optional legacy calendar migration below is needed.

```bash
cd /opt/3dipl/app
git pull --ff-only origin main
sudo docker compose -f compose.production.yml build backend frontend
sudo docker compose -f compose.production.yml run --rm --no-deps --interactive=false -T backend npm run env:check </dev/null
sudo docker compose -f compose.production.yml up -d --no-deps backend frontend
sudo docker compose -f compose.production.yml run --rm --no-deps --interactive=false -T backend npm run subscription:dry-run </dev/null
```

Review a Core database backup, verify it, and obtain its BackupRun ID using the
existing backup tooling. Migration execution rejects missing, unverified or
older-than-26-hour backups. Review the dry-run and backup before the following
explicit write operation:

```bash
sudo docker compose -f compose.production.yml run --rm --no-deps --interactive=false -T \
  -e MIGRATION_CONFIRM=subscription-calendar-v2 \
  -e SUBSCRIPTION_BACKUP_RUN_ID='<reviewed verified Core BackupRun ID>' \
  backend npm run subscription:migrate </dev/null
```

Migration is batched and idempotent. It does not activate or change plan prices.
Restarting the backend cannot restore old plans or overwrite edited prices.
New paid subscriptions also import an existing user's baseline atomically.

## Admin

1. Packages > Subscription lists all non-archived plans together. Optionally
   use Add 9 draft plans to add the initial day/month/year examples. Existing
   codes, prices and enabled states are never overwritten.
2. Enter VND and optional USD prices, names, positive integer quotas/durations,
   purchase limits, features and order. Enable ready plans.
3. Toggle On sale directly on each plan or in its editor. Ready plans appear
   immediately under the corresponding Topup period; disabled plans remain
   editable. Blank prices cannot be enabled and do not become free trials.
   There is no catalog activation step. Calls from old admin clients to the
   activation endpoint no longer retire any plans. Pending orders remain
   payable from their snapshots; archiving still preserves paid benefits.
4. Check month default, deep links to day/year, VI/EN checkout, current/queued
   periods, web/plugin quota and account events after approval/transition.

Admin current-period adjustments shift upcoming periods while preserving their
calendar durations. Clear requires confirmation and cancels all remaining
periods; it does not refund payments. Existing audit middleware logs actions.

## Rollback

Disable "Accept new purchases" in Subscription admin. Do not revert to a
backend that lacks the schedule service once any V2 period has been paid.
Keep workers, payment reconciliation and account/download reconciliation
running so paid and queued rights are preserved. Resume checkout after fixes.
