const EXPECTED_SERVICE_UNAVAILABLE_CODES = new Set([
  "PLUGIN_API_DISABLED",
  "PLUGIN_RELEASE_DISABLED",
]);

export function isExpectedServiceUnavailable(error, status) {
  return Number(status) === 503
    && EXPECTED_SERVICE_UNAVAILABLE_CODES.has(String(error?.code || ""));
}
