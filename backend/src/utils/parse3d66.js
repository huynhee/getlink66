export function extractProductId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw Object.assign(new Error("Invalid URL"), { status: 400 });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw Object.assign(new Error("Only HTTP(S) URLs are supported"), { status: 400 });
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "3d66.com" && !hostname.endsWith(".3d66.com")) {
    throw Object.assign(new Error("Only 3d66.com links are supported"), { status: 400 });
  }

  const pathParts = parsed.pathname.split("/").filter(Boolean);
  const lastPart = pathParts[pathParts.length - 1] || "";
  const numericMatches = [...parsed.pathname.matchAll(/(\d{4,})/g)].map((match) => match[1]);
  const numericId = numericMatches.sort((a, b) => b.length - a.length)[0] || "";
  const slugMatch = lastPart.match(/[a-zA-Z0-9_-]+/);
  const productId = parsed.searchParams.get("sof") || parsed.searchParams.get("id") || numericId || slugMatch?.[0];

  if (!productId) {
    throw Object.assign(new Error("Cannot extract product id from URL"), { status: 400 });
  }

  return productId;
}
