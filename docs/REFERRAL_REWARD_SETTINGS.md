# Referral Reward Settings

Admins can edit rewards in **General > Referrals**. The existing mode and
reward-type controls remain available; reward amounts accept whole numbers
between 1 and 100000. Disable a reward type with its selector, not a zero amount.

| Setting | Default | Meaning |
| --- | --- | --- |
| `referralRewardCredit` | 28 | Credits per qualifying signup, per rewarded account |
| `referralRewardModelDownloads` | 100 | Today's base Model download quota target |

The settings live in the existing Atlas Core `SiteSetting` document. No env
changes or data migration are required. Missing values use the old defaults.

Credit is awarded once per qualifying signup. The download reward expires at
midnight in `Asia/Saigon`. Free users receive a same-day Subscription; active
subscribers keep their purchased base quota and expiry and receive only the
additional quota needed to reach the configured target today. Paid extra
downloads are preserved. Model costs one quota unit; Scene costs five.

Multiple referrals do not multiply the daily quota target. Changing settings
affects future referrals only: it never retracts a completed reward, rewrites
history, or changes the amount of a pending quota grant. New referral records
snapshot both amounts; legacy Pro rewards continue to display their original
100-download quota. Home/invitation copy uses configured amounts; custom
homepage referral headings remain editable.

Core records pending quota grants durably; existing VPS retry processing applies
them once, or marks them expired after the reward day. Normal account update
events notify web/plugin clients after the reward or quota synchronization.

## Verification

```bash
node --test backend/test/referral-rewards.test.js backend/test/referral-presentation.test.js
npm run check
npm run build --prefix frontend
npm run qa:smoke --prefix backend -- ../frontend/dist ../qa-report/screenshots ../qa-report/performance-results/smoke.json
```

Automated tests use memory fixtures only. Browser smoke covers saving configured
amounts and displaying them in both languages, themes and viewport sizes.
