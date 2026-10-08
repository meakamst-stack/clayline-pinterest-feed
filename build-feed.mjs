#!/usr/bin/env node
/**
 * Clay & Line — Pinterest productfeed builder
 *
 * Haalt alle publieke producten op uit de Fourthwall Storefront API en schrijft een
 * Pinterest-catalogusfeed (CSV) naar docs/pinterest-feed.csv.
 *
 * Eén regel per poster en één per set (bundel). Posters hebben één kleur (White) en
 * acht maten; de maten gaan NIET als aparte regels mee (Pinterest maakt een pin van
 * elke regel × elke afbeelding). Prijs = vanaf-prijs (kleinste maat). Afbeeldingen
 * komen uitsluitend uit de eigen kamermockups (docs/pins + manifest.json); een product
 * zonder mockup komt niet in de feed. Afgeleid van aesth-pinterest-feed (okt 2026).
 *
 * Draaien:  FW_STOREFRONT_TOKEN=ptkn_... node build-feed.mjs
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------- instellingen

const CONFIG = {
  token: process.env.FW_STOREFRONT_TOKEN,
  apiBase: process.env.FW_API_BASE || "https://storefront-api.fourthwall.com/v1",
  // Zolang clayandline.com nog niet aan de shop hangt: SITE_BASE=https://poster-upj-shop.fourthwall.com
  siteBase: (process.env.SITE_BASE || "https://clayandline.com").replace(/\/+$/, ""),
  currency: "USD",
  brand: "Clay & Line",
  googleCategory: "Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork",
  productType: "Home Decor > Wall Art > Bathroom",
  outFile: "docs/pinterest-feed.csv",

  utm: { source: "pinterest", medium: "catalog", campaign: "pinterest-catalog" },

  // Extra afbeeldingen per regel (elke extra afbeelding = een extra pin). Het manifest
  // heeft per product 2 afbeeldingen (hoofdfoto + tweede sfeer / set-overzicht).
  additionalImages: Number(process.env.ADDITIONAL_IMAGES ?? 1),

  fourthwallFallback: process.env.FW_FALLBACK === "1",
  pinsManifest: "docs/pins/manifest.json",
  pinsDir: "docs/pins",
  pinsBaseUrl: "https://meakamst-stack.github.io/clayline-pinterest-feed/pins/",

  // Beveiliging: weiger een feed die >30 % krimpt of ineens geen mockups meer heeft.
  force: process.env.FORCE === "1" || process.env.FORCE === "true",
  maxDrop: Number(process.env.FEED_MAX_DROP ?? 0.3),

  fetchTimeoutMs: 30_000,
  fetchAttempts: 3,
};

function loadPins() {
  if (!existsSync(CONFIG.pinsManifest)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG.pinsManifest, "utf8"));
  } catch (err) {
    console.warn(`Let op: ${CONFIG.pinsManifest} niet leesbaar (${err.message}).`);
    return null;
  }
}
const PINS = loadPins();
const zonderMockup = new Set();
const ontbrekendePins = new Set();

/** Mockup-URL's voor één product: [hoofdfoto, ...overige] of []. */
function pinImages(slug) {
  const lijst = PINS?.producten?.[slug]?.afbeeldingen;
  if (!Array.isArray(lijst)) return [];
  return lijst
    .filter((p) => {
      const ok = existsSync(join(CONFIG.pinsDir, p));
      if (!ok) ontbrekendePins.add(p);
      return ok;
    })
    .map((p) => CONFIG.pinsBaseUrl + p);
}

const COLUMNS = [
  "id",
  "title",
  "description",
  "link",
  "image_link",
  "price",
  "availability",
  "condition",
  "brand",
  "google_product_category",
  "product_type",
  "item_group_id",
  "additional_image_link",
  "custom_label_0",
  "custom_label_1",
];

// ---------------------------------------------------------------- hulpfuncties

function toPlainText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|li|h[1-6]|div|ul|ol|tr|td|th)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(rsquo|lsquo);/gi, "'")
    .replace(/&(rdquo|ldquo);/gi, '"')
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&hellip;/gi, "…")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

function csvField(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function productUrl(slug) {
  const u = new URL(`${CONFIG.siteBase}/products/${slug}`);
  u.searchParams.set("utm_source", CONFIG.utm.source);
  u.searchParams.set("utm_medium", CONFIG.utm.medium);
  u.searchParams.set("utm_campaign", CONFIG.utm.campaign);
  u.searchParams.set("utm_content", slug);
  return u.toString();
}

// ------------------------------------------------------------------- ophalen

async function fetchJson(url) {
  let lastErr;
  for (let attempt = 1; attempt <= CONFIG.fetchAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(CONFIG.fetchTimeoutMs),
        headers: { "cache-control": "no-cache", pragma: "no-cache" },
      });
      if (res.status >= 500 || res.status === 429) throw new Error(`Storefront API gaf ${res.status} ${res.statusText}`);
      if (!res.ok) throw Object.assign(new Error(`Storefront API gaf ${res.status} ${res.statusText}`), { fatal: true });
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (err.fatal || attempt === CONFIG.fetchAttempts) break;
      const wait = 2000 * attempt;
      console.warn(`Poging ${attempt} mislukt (${err.message}) — opnieuw over ${wait / 1000} s.`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function fetchAllProducts() {
  const products = [];
  let page = 0;
  let expectedTotal = null;
  for (;;) {
    const url =
      `${CONFIG.apiBase}/collections/all/products` +
      `?storefront_token=${encodeURIComponent(CONFIG.token)}` +
      `&currency=${CONFIG.currency}&page=${page}&size=50&_=${Date.now()}`;
    const data = await fetchJson(url);
    products.push(...(data.results || []));
    if (typeof data.paging?.elementsTotal === "number") expectedTotal = data.paging.elementsTotal;
    if (!data.paging?.hasNextPage) break;
    page += 1;
    if (page > 40) throw new Error("Te veel pagina's — waarschijnlijk een oneindige lus.");
  }
  if (expectedTotal !== null && expectedTotal !== products.length) {
    throw new Error(`API meldt ${expectedTotal} producten maar gaf er ${products.length} — onvolledige respons.`);
  }
  return products;
}

// -------------------------------------------------------------------- omzetten

function variantSoldOut(variant) {
  return variant.stock?.type === "LIMITED" && !(variant.stock?.inStock > 0);
}

/** Eén feedregel per product (poster of set). */
function productRow(product) {
  const slug = product.slug;
  // De set-link bovenaan posterpagina's ("Complete the look: shop the … set of 3 and save 16% →")
  // is voor de site; Google keurt promotietekst in beschrijvingen af → niet in de feed.
  const zonderSetLink = String(product.description || "").replace(/<p>(?:(?!<\/p>)[\s\S])*Complete the look(?:(?!<\/p>)[\s\S])*<\/p>/gi, "");
  const plain = toPlainText(zonderSetLink);
  if (!plain) console.warn(`Let op: ${slug} heeft geen beschrijving — productnaam gebruikt.`);
  const description = truncate(plain || product.name, 5000);

  let images = pinImages(slug);
  if (!images.length) {
    zonderMockup.add(slug);
    if (!CONFIG.fourthwallFallback) return null;
    images = (product.images || []).map((i) => i.url);
    if (!images.length) return null;
  }

  // Vanaf-prijs: laagste variantprijs; bundels zonder varianten → productprijs als die er is.
  const variants = product.variants || [];
  const priced = variants.filter((v) => v.unitPrice?.value > 0);
  let price = null;
  if (priced.length) {
    price = priced.reduce((a, b) => (Number(b.unitPrice.value) < Number(a.unitPrice.value) ? b : a)).unitPrice;
  } else if (product.price?.value > 0) {
    price = product.price;
  } else if (product.unitPrice?.value > 0) {
    price = product.unitPrice;
  }
  if (!price) {
    console.warn(`Let op: ${slug} (${product.type}) heeft geen prijs in de API — overgeslagen.`);
    return null;
  }

  const soldOut = product.state?.type === "SOLD_OUT" || (variants.length > 0 && variants.every(variantSoldOut));
  const meta = PINS?.producten?.[slug] || {};

  return {
    id: slug,
    title: truncate(product.name, 500),
    description,
    link: productUrl(slug),
    image_link: images[0],
    price: `${Number(price.value).toFixed(2)} ${price.currency || CONFIG.currency}`,
    availability: soldOut ? "out of stock" : "in stock",
    condition: "new",
    brand: CONFIG.brand,
    google_product_category: CONFIG.googleCategory,
    product_type: CONFIG.productType,
    item_group_id: slug,
    additional_image_link: images.slice(1, 1 + CONFIG.additionalImages).join(","),
    custom_label_0: meta.serie || "", // serie (bv. terracotta-arches-01) — voor advertentiegroepen
    custom_label_1: meta.set ? "set" : "poster",
  };
}

// ---------------------------------------------------------------- beveiliging

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

function feedStats(rows, header) {
  const il = header.indexOf("image_link");
  const ia = header.indexOf("additional_image_link");
  const imgCount = (r) => 1 + (ia >= 0 && r[ia] ? String(r[ia]).split(",").length : 0);
  return {
    rows: rows.length,
    withPins: rows.filter((r) => String(r[il]).startsWith(CONFIG.pinsBaseUrl)).length,
    images: rows.reduce((n, r) => n + imgCount(r), 0),
  };
}

function readExistingStats(path) {
  if (!existsSync(path)) return null;
  try {
    const [header, ...rows] = parseCsv(readFileSync(path, "utf8"));
    if (!header?.includes("image_link")) return null;
    return feedStats(rows, header);
  } catch (err) {
    console.warn(`Let op: bestaande feed niet leesbaar (${err.message}) — vergelijking overgeslagen.`);
    return null;
  }
}

function guard(newRows) {
  const reasons = [];
  const nieuw = feedStats(newRows.map((r) => COLUMNS.map((c) => r[c])), COLUMNS);
  const oud = readExistingStats(CONFIG.outFile);
  if (oud) {
    const grens = 1 - CONFIG.maxDrop;
    const pct = Math.round(CONFIG.maxDrop * 100);
    if (nieuw.rows < oud.rows * grens) reasons.push(`producten dalen van ${oud.rows} naar ${nieuw.rows} (meer dan ${pct} %)`);
    if (oud.withPins > 0 && nieuw.withPins === 0) reasons.push(`de bestaande feed had ${oud.withPins} eigen mockups, de nieuwe 0`);
  }
  if (PINS && Object.keys(PINS.producten || {}).length && nieuw.withPins === 0) {
    reasons.push("manifest.json bevat mockups, maar geen enkele regel kreeg er een als image_link");
  }
  const fmt = (s) => `${s.rows} regels / ${s.withPins} met eigen mockup / ±${s.images} pins`;
  console.log(`Controle: ${fmt(nieuw)}` + (oud ? ` (bestaande feed: ${fmt(oud)})` : " (geen bestaande feed)"));
  return reasons;
}

// --------------------------------------------------------- Google Merchant Center

/**
 * Tweede uitvoer voor Google Merchant Center (geplande ophaalactie): docs/google-feed.tsv.
 * Zelfde regels als de Pinterest-feed, met twee verschillen:
 *  - alleen kamermockups: het set-overzicht (beeld met tekst) gaat niet mee — Google keurt
 *    afbeeldingen met tekst/overlays af;
 *  - identifier_exists = no (eigen ontwerpen, geen GTIN/MPN), product_type/categorie zoals Pinterest.
 *  - shipping per regel: Fourthwall rekent in de VS een vast tarief per bestelling dat afhangt van de
 *    grootste poster (t/m 18×24: $5,79; 20×30/24×36: $8,79) plus $0,40 per extra poster (gemeten 6 okt 2026
 *    via proef-checkouts naar NY/CA). De feedregel toont de vanaf-prijs (8×10), dus poster $5,79, set $6,59.
 *    Google keurt alleen af als de echte kosten hoger zijn dan opgegeven; voor grotere maten rekent de
 *    klant in de checkout meer, maar dat is een andere variant dan de aangeboden. Retourbeleid: in Merchant Center.
 */
const GOOGLE_SHIPPING = { poster: "US:::5.79 USD", set: "US:::6.59 USD" };

const GOOGLE_COLUMNS = [
  "id", "title", "description", "link", "image_link", "additional_image_link",
  "availability", "price", "brand", "condition", "google_product_category",
  "product_type", "identifier_exists", "shipping", "custom_label_0", "custom_label_1",
];

function tsvField(value) {
  return (value === null || value === undefined ? "" : String(value)).replace(/[\t\r\n]+/g, " ");
}

// Google Merchant Center staat max. 50 tekens toe voor id en item_group_id (sets hebben
// langere slugs). Korter maken met een vaste hash, zodat de id stabiel en uniek blijft.
function googleId(value) {
  const v = String(value || "");
  if (v.length <= 50) return v;
  const hash = createHash("sha1").update(v).digest("hex").slice(0, 8);
  return `${v.slice(0, 41).replace(/-+$/, "")}-${hash}`;
}

function writeGoogleFeed(rows) {
  const out = rows.map((r) => {
    const extra = (r.additional_image_link || "")
      .split(",")
      .filter((u) => u && !/set-overview/.test(u));
    return {
      ...r,
      id: googleId(r.id),
      item_group_id: googleId(r.item_group_id),
      additional_image_link: extra.join(","),
      identifier_exists: "no",
      shipping: r.custom_label_1 === "set" ? GOOGLE_SHIPPING.set : GOOGLE_SHIPPING.poster,
      // Google wil de link zonder pinterest-UTM; eigen UTM voor 'Sales by UTM' in Fourthwall
      link: r.link.replace("utm_source=pinterest", "utm_source=google").replace("utm_medium=catalog", "utm_medium=shopping").replace("utm_campaign=pinterest-catalog", "utm_campaign=google-shopping"),
    };
  });
  const tsv = [GOOGLE_COLUMNS.join("\t"), ...out.map((r) => GOOGLE_COLUMNS.map((c) => tsvField(r[c])).join("\t"))].join("\n");
  const file = "docs/google-feed.tsv";
  writeFileSync(file + ".tmp", tsv + "\n", "utf8");
  renameSync(file + ".tmp", file);
  console.log(`Google-feed geschreven naar ${file}: ${out.length} regels`);
}

// ------------------------------------------------------------------ uitvoeren

async function main() {
  if (!CONFIG.token) {
    console.error("Fout: omgevingsvariabele FW_STOREFRONT_TOKEN ontbreekt.");
    process.exit(1);
  }

  const all = await fetchAllProducts();
  const types = {};
  for (const p of all) types[p.type] = (types[p.type] || 0) + 1;
  console.log(`API: ${all.length} items (${Object.entries(types).map(([t, n]) => `${t}: ${n}`).join(", ")})`);

  // Posters én sets (bundels); alleen wat publiek is.
  const usable = all.filter((p) => p.access?.type === "PUBLIC" && p.slug);
  const rows = usable.map(productRow).filter(Boolean);

  if (!rows.length) {
    console.error(
      "Fout: geen enkel bruikbaar product gevonden — feed niet weggeschreven." +
        (zonderMockup.size ? ` Zonder eigen mockup: ${[...zonderMockup].join("; ")}` : "")
    );
    process.exit(1);
  }

  const seen = new Set();
  const duplicates = rows.filter((r) => seen.size === seen.add(r.id).size).map((r) => r.id);
  if (duplicates.length) {
    console.error(`Fout: dubbele id's in de feed: ${duplicates.join(", ")}`);
    process.exit(1);
  }

  const reasons = guard(rows);
  if (reasons.length) {
    if (CONFIG.force) {
      console.warn(`FORCE=1: beveiliging bewust omzeild. Redenen die anders zouden blokkeren:\n  - ${reasons.join("\n  - ")}`);
    } else {
      console.error(
        `GEWEIGERD — bestaande feed blijft staan. Redenen:\n  - ${reasons.join("\n  - ")}\n` +
          `Is dit een bewuste wijziging? Start de workflow handmatig met het vinkje 'force' (FORCE=1).`
      );
      process.exit(2);
    }
  }
  if (ontbrekendePins.size) console.warn(`Let op: manifest verwijst naar ontbrekende bestanden (overgeslagen): ${[...ontbrekendePins].join(", ")}`);
  if (zonderMockup.size) {
    console.warn(
      CONFIG.fourthwallFallback
        ? `Let op: zonder eigen mockup (FW_FALLBACK=1, Fourthwall-foto gebruikt): ${[...zonderMockup].join("; ")}`
        : `Let op: NIET in de feed (geen eigen mockup — maak ze met designs/_make/mockup.py + pins.py): ${[...zonderMockup].join("; ")}`
    );
  }

  const csv = [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => csvField(r[c])).join(","))].join("\n");
  mkdirSync(dirname(CONFIG.outFile), { recursive: true });
  const tmp = CONFIG.outFile + ".tmp";
  writeFileSync(tmp, csv + "\n", "utf8");
  renameSync(tmp, CONFIG.outFile);

  writeGoogleFeed(rows);

  const pins = rows.reduce((n, r) => n + 1 + (r.additional_image_link ? r.additional_image_link.split(",").length : 0), 0);
  const sets = rows.filter((r) => r.custom_label_1 === "set").length;
  console.log(`Feed geschreven naar ${CONFIG.outFile}: ${rows.length} regels (${rows.length - sets} posters + ${sets} sets), ±${pins} pins, ${csv.length} bytes`);
  const skipped = all.length - usable.length;
  if (skipped > 0) console.log(`${skipped} item(s) overgeslagen (niet publiek)`);
}

main().catch((err) => {
  console.error("Feed bouwen mislukt:", err.message);
  process.exit(1);
});
