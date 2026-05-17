import { isMemoryDb } from "../config/memoryStore.js";

const MONGO_ID_RE = /^[a-fA-F0-9]{24}$/;
const MEMORY_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const VOUCHER_CODE_RE = /^[A-Z0-9_-]{3,32}$/;

export function isSafeId(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return isMemoryDb() ? MEMORY_ID_RE.test(text) : MONGO_ID_RE.test(text);
}

export function normalizeVoucherCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function isVoucherCode(value) {
  return VOUCHER_CODE_RE.test(normalizeVoucherCode(value));
}

export function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function integerInRange(value, min, max) {
  const number = finiteNumber(value);
  if (number === null || !Number.isInteger(number) || number < min || number > max) return null;
  return number;
}

export function numberInRange(value, min, max) {
  const number = finiteNumber(value);
  if (number === null || number < min || number > max) return null;
  return number;
}

export function limitedString(value, maxLength, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

export function rejectUnknownKeys(body = {}, allowedKeys = []) {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(body || {}).filter((key) => !allowed.has(key));
  if (!unknown.length) return "";
  return unknown[0];
}

/**
 * Strip HTML tags and dangerous patterns from user-provided strings.
 * Lightweight alternative to DOMPurify for server-side use.
 */
export function sanitizeHtml(value, maxLength = 2000) {
  if (typeof value !== "string") return "";
  return value
    .slice(0, maxLength)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/on\w+\s*=\s*\S+/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/data\s*:\s*text\/html/gi, "")
    .replace(/<\/?[^>]+(>|$)/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * Safe string: trimmed, length-capped, and HTML-stripped.
 * Use for user-facing text fields (labels, names, etc.).
 */
export function sanitizeString(value, maxLength = 500) {
  return sanitizeHtml(value, maxLength);
}
