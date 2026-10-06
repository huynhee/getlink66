import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireExpress = createRequire(import.meta.resolve("express"));
const proxyAddr = requireExpress("proxy-addr");

function request(remoteAddress, forwardedFor) {
  return { socket: { remoteAddress }, headers: { "x-forwarded-for": forwardedFor } };
}

test("Express proxy matching does not trust public IPv4 through malformed IPv6 trust prefixes", () => {
  for (const subnet of ["::ffff:10.0.0.0/8", "::/1"]) {
    const trust = proxyAddr.compile(subnet);
    assert.equal(trust("203.0.113.42"), false, subnet);
    assert.equal(proxyAddr(request("203.0.113.42", "198.51.100.9"), trust), "203.0.113.42");
  }
});

test("valid IPv4 and mapped IPv6 trust prefixes still accept only their own private subnet", () => {
  for (const subnet of ["10.0.0.0/8", "::ffff:10.0.0.0/104"]) {
    const trust = proxyAddr.compile(subnet);
    assert.equal(trust("10.20.30.40"), true, subnet);
    assert.equal(trust("::ffff:10.20.30.40"), true, subnet);
    assert.equal(trust("203.0.113.42"), false, subnet);
    assert.equal(trust("192.168.1.10"), false, subnet);
  }
});

test("Express ignores spoofed forwarded IPs unless the immediate peer is trusted", () => {
  const trust = proxyAddr.compile("10.0.0.0/8");
  assert.equal(proxyAddr(request("203.0.113.42", "198.51.100.9"), trust), "203.0.113.42");
  assert.equal(proxyAddr(request("10.0.0.1", "198.51.100.9"), trust), "198.51.100.9");
});
