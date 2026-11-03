import assert from "node:assert/strict";
import test from "node:test";
import { mapVerificationPointer } from "../../frontend/src/utils/verificationPointer.js";

function expectPoint(actual, x, y) {
  assert.ok(actual);
  assert.ok(Math.abs(actual.x - x) < 0.001, `Expected x=${x}, received ${actual.x}`);
  assert.ok(Math.abs(actual.y - y) < 0.001, `Expected y=${y}, received ${actual.y}`);
}

test("remote pointer coordinates follow native and legacy viewports across responsive sizes", () => {
  for (const viewport of [{ width: 1400, height: 800 }, { width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    for (const width of [310, 680, 1280]) {
      const bounds = { left: 25, top: 130, width, height: width * viewport.height / viewport.width };
      const pointer = { clientX: bounds.left + bounds.width * 0.2, clientY: bounds.top + bounds.height * 0.3 };
      expectPoint(mapVerificationPointer(pointer, bounds, viewport), viewport.width * 0.2, viewport.height * 0.3);
    }
  }
});

test("letterboxed screenshots do not shift manually supplied coordinates", () => {
  const viewport = { width: 1400, height: 800 };
  const vertical = { left: 10, top: 20, width: 700, height: 437.5 };
  expectPoint(mapVerificationPointer({ clientX: 150, clientY: 158.75 }, vertical, viewport), 280, 240);
  assert.equal(mapVerificationPointer({ clientX: 150, clientY: 25 }, vertical, viewport), null);
  const horizontal = { left: 10, top: 20, width: 800, height: 400 };
  expectPoint(mapVerificationPointer({ clientX: 200, clientY: 140 }, horizontal, viewport), 280, 240);
  assert.equal(mapVerificationPointer({ clientX: 20, clientY: 140 }, horizontal, viewport), null);
});

test("dragging outside clamps to viewport edges while padding cannot start a drag", () => {
  const viewport = { width: 1400, height: 800 };
  const bounds = { left: 10, top: 20, width: 700, height: 400 };
  assert.equal(mapVerificationPointer({ clientX: 0, clientY: 0 }, bounds, viewport), null);
  expectPoint(mapVerificationPointer({ clientX: 0, clientY: 0 }, bounds, viewport, true), 0, 0);
  expectPoint(mapVerificationPointer({ clientX: 9999, clientY: 9999 }, bounds, viewport, true), 1399, 799);
});

test("missing or invalid frame geometry never generates remote input", () => {
  const point = { clientX: 100, clientY: 100 };
  const bounds = { left: 10, top: 20, width: 700, height: 400 };
  const viewport = { width: 1400, height: 800 };
  for (const invalid of [null, {}, { ...viewport, width: 0 }, { ...viewport, height: NaN }]) {
    assert.equal(mapVerificationPointer(point, bounds, invalid), null);
  }
  assert.equal(mapVerificationPointer({ clientX: Infinity, clientY: 100 }, bounds, viewport), null);
  assert.equal(mapVerificationPointer(point, { ...bounds, width: 0 }, viewport), null);
});
