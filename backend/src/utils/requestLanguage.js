export function defaultLanguageFromCountry(value) {
  if (typeof value !== "string") return null;
  const country = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || country === "XX") return null;
  return country === "VN" ? "vi" : "en";
}
