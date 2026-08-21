import test from "node:test";
import assert from "node:assert/strict";
import { adminDashboardDateRange } from "../src/controllers/adminV1Controller.js";

test("admin day dashboard uses the Asia/Saigon calendar day", () => {
  const now = new Date("2026-07-13T09:17:00.000Z");
  const range = adminDashboardDateRange({ period: "day" }, now);

  assert.equal(range.from.toISOString(), "2026-07-12T17:00:00.000Z");
  assert.equal(range.to.toISOString(), "2026-07-13T16:59:59.999Z");
});

test("admin dashboard preserves explicit date ranges", () => {
  const range = adminDashboardDateRange({
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-07-02T00:00:00.000Z",
  });

  assert.equal(range.from.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(range.to.toISOString(), "2026-07-02T00:00:00.000Z");
});
