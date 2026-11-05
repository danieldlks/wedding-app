// Reads a shop's product page and pulls out what the registry needs: name,
// photo, price and shop name. Uses the page's structured data (JSON-LD
// Product), then Open Graph / product meta tags, then <title>. Shops that
// block automated requests (Amazon often does) just come back with whatever
// could be found, and the admin fills in the rest by hand.

const MAX_BYTES = 1_500_000;

export async function fetchProductInfo(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl || "").trim()); } catch { return { ok: false, reason: "invalid-url" }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "invalid-url" };

  let res;
  try {
    res = await fetch(url.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9"
      }
    });
  } catch {
    return { ok: false, reason: "unreachable", shop: shopFromHost(url.hostname), url: url.toString() };
  }
  const finalUrl = res.url || url.toString();
  if (!res.ok) return { ok: false, reason: "blocked", shop: shopFromHost(new URL(finalUrl).hostname), url: url.toString() };

  const html = await readCapped(res);
  return { ok: true, url: url.toString(), ...parseProductHtml(html, finalUrl) };
}

async function readCapped(res) {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "", bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (bytes >= MAX_BYTES) { try { await reader.cancel(); } catch { /* ignore */ } break; }
  }
  return out;
}

export function parseProductHtml(html, pageUrl) {
  const meta = readMetaTags(html);
  const product = findJsonLdProduct(html);

  let name = product?.name || meta["og:title"] || meta["twitter:title"] || titleTag(html) || "";
  let image = firstImage(product?.image) || meta["og:image:secure_url"] || meta["og:image"] || meta["twitter:image"] || meta["twitter:image:src"] || "";
  let price = offerPrice(product?.offers);
  if (price == null) price = toPrice(meta["product:price:amount"] ?? meta["og:price:amount"] ?? meta["product:sale_price:amount"]);
  const host = safeHost(pageUrl);
  const shop = (meta["og:site_name"] || brandName(product?.brand) || shopFromHost(host)).trim();

  name = cleanName(decodeEntities(String(name)), shop);
  image = absolutise(decodeEntities(String(image)).trim(), pageUrl);
  return { name: name.slice(0, 150), imageUrl: image, price, shop: decodeEntities(shop).slice(0, 60) };
}

function readMetaTags(html) {
  const out = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = attr(tag, "property") || attr(tag, "name") || attr(tag, "itemprop");
    const content = attr(tag, "content");
    if (key && content != null && !(key.toLowerCase() in out)) out[key.toLowerCase()] = content;
  }
  return out;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4]) : null;
}

function titleTag(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : "";
}

function findJsonLdProduct(html) {
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const found = walkForProduct(data, 0);
    if (found) return found;
  }
  return null;
}

function walkForProduct(node, depth) {
  if (!node || typeof node !== "object" || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) { const f = walkForProduct(n, depth + 1); if (f) return f; }
    return null;
  }
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some(t => t === "Product" || t === "ProductGroup")) return node;
  if (node["@graph"]) return walkForProduct(node["@graph"], depth + 1);
  if (node.mainEntity) return walkForProduct(node.mainEntity, depth + 1);
  return null;
}

function firstImage(img) {
  if (!img) return "";
  if (typeof img === "string") return img;
  if (Array.isArray(img)) return firstImage(img[0]);
  return img.url || img.contentUrl || "";
}

function offerPrice(offers) {
  if (!offers) return null;
  if (Array.isArray(offers)) {
    for (const o of offers) { const p = offerPrice(o); if (p != null) return p; }
    return null;
  }
  const direct = toPrice(offers.price ?? offers.lowPrice);
  if (direct != null) return direct;
  if (offers.priceSpecification) return offerPrice(Array.isArray(offers.priceSpecification) ? offers.priceSpecification : [offers.priceSpecification]);
  if (offers.offers) return offerPrice(offers.offers);
  return null;
}

function toPrice(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : null;
}

function brandName(b) {
  if (!b) return "";
  if (typeof b === "string") return b;
  if (Array.isArray(b)) return brandName(b[0]);
  return b.name || "";
}

function safeHost(u) { try { return new URL(u).hostname; } catch { return ""; } }

// "www.davidjones.com" -> "Davidjones", "shop.example.com.au" -> "Example".
export function shopFromHost(host) {
  if (/^[\d.]+$|:/.test(String(host || ""))) return ""; // an IP address, not a shop
  const parts = String(host || "").toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  const generic = new Set(["com", "net", "org", "co", "au", "nz", "uk", "shop", "store", "www", "m"]);
  const label = parts.find((p, i) => !generic.has(p) && i < parts.length - 1) || parts[0] || "";
  return label ? label[0].toUpperCase() + label.slice(1) : "";
}

// Drops a trailing " | Shop" / " - Shop" that many pages add to their titles.
function cleanName(name, shop) {
  let n = name.replace(/\s+/g, " ").trim();
  if (shop) {
    const esc = shop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const trimmed = n.replace(new RegExp(`\\s*[|\\-–—:]\\s*${esc}.*$`, "i"), "").trim();
    if (trimmed) n = trimmed;
  }
  return n;
}

function absolutise(src, base) {
  if (!src) return "";
  try {
    const u = new URL(src, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch { return ""; }
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
