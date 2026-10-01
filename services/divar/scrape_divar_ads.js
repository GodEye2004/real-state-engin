import { chromium } from "playwright";

const AD_LINK_PATTERN = 'a[href*="/v/"]';
const MAX_SCROLL_ROUNDS = 100;
const SCROLL_WAIT_MS = 2000;
const PAGE_LOAD_WAIT_MS = 5000;

let browserInstance = null;
let pageInstance = null;

async function ensureBrowser() {
  if (browserInstance) return { browser: browserInstance, page: pageInstance };
  const headless = process.env.PLAYWRIGHT_HEADLESS !== "false";
  browserInstance = await chromium.launch({ headless });
  const context = await browserInstance.newContext({
    viewport: { width: 1280, height: 850 },
  });
  pageInstance = await context.newPage();
  return { browser: browserInstance, page: pageInstance };
}

async function navigateToSearch(url) {
  const { page } = await ensureBrowser();
  console.log(`[Scraper] Navigating to: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(PAGE_LOAD_WAIT_MS);
  console.log("[Scraper] Page ready.");
  return page;
}

async function humanScroll(page, hoverX, hoverY, wheelPixels) {
  const x = hoverX > 0 ? hoverX : 640;
  const y = hoverY > 0 ? hoverY : 700;
  await page.mouse.move(x, y);
  await page.waitForTimeout(150 + Math.random() * 150);
  const steps = wheelPixels <= 800 ? 1 : 3;
  const perStep = Math.max(100, Math.round(wheelPixels / steps));
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, perStep + Math.round(Math.random() * 120));
    await page.waitForTimeout(200 + Math.random() * 250);
  }
}

async function scrollToLoadAds(page, options = {}) {
  const {
    maxRounds = MAX_SCROLL_ROUNDS,
    scrollAmount = 1400,
    staleThreshold = 5,
    onProgress = null,
  } = options;
  let staleCount = 0;
  let previousUniqueCount = 0;
  const collected = new Map();

  for (let i = 0; i < maxRounds; i++) {
    const visibleAds = await extractRawAds(page);
    for (const ad of visibleAds) {
      collected.set(ad.link, ad);
    }

    const uniqueCount = collected.size;
    if (uniqueCount === previousUniqueCount) {
      staleCount++;
      if (staleCount >= staleThreshold) break;
    } else {
      staleCount = 0;
    }

    previousUniqueCount = uniqueCount;
    console.log(
      `[Scraper] Scroll ${i + 1}: ${visibleAds.length} visible, ${uniqueCount} unique`,
    );
    if (onProgress)
      onProgress({
        round: i + 1,
        maxRounds,
        cardsVisible: visibleAds.length,
        adsCollected: uniqueCount,
      });

    await page.evaluate((amount) => {
      const anchors = [...document.querySelectorAll('a[href*="/v/"]')];
      let element = anchors[0] || document.body;

      while (element && element !== document.body) {
        if (element.scrollHeight > element.clientHeight + 20) {
          element.scrollBy(0, amount);
          return;
        }
        element = element.parentElement;
      }

      window.scrollBy(0, amount);
    }, scrollAmount);
    await humanScroll(page, 640, 700, Math.min(scrollAmount, 800));
    await page.waitForTimeout(SCROLL_WAIT_MS);
  }

  const finalAds = await extractRawAds(page);
  for (const ad of finalAds) {
    collected.set(ad.link, ad);
  }

  console.log(
    `[Scraper] Scroll complete. ${collected.size} unique ads collected.`,
  );
  return [...collected.values()];
}

function toEN(str) {
  return str.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}

function parsePrice(text) {
  if (!text) return null;
  const c = toEN(text.replace(/,/g, "")).trim();
  let m = c.match(/([\d.]+)\s*میلیارد/);
  if (m) return Math.round(parseFloat(m[1]) * 1e9);
  m = c.match(/([\d.]+)\s*میلیون/);
  if (m) return Math.round(parseFloat(m[1]) * 1e6);
  m = c.match(/([\d.]+)\s*تومان/);
  if (m) return Math.round(parseFloat(m[1]));
  m = c.match(/([\d.]+)/);
  if (m) return Math.round(parseFloat(m[1]));
  return null;
}

function extractRawAds(page) {
  return page.$$eval(AD_LINK_PATTERN, (anchors) =>
    anchors.map((el) => {
      const lines = el.innerText.split("\n").filter((t) => t.trim() !== "");
      const title = lines[0] || "بدون عنوان";
      const href = el.getAttribute("href") || "#";
      const link = href.startsWith("http") ? href : `https://divar.ir${href}`;
      return {
        title,
        link,
        details: lines.slice(1).join(" | "),
        allText: el.innerText,
      };
    }),
  );
}

function normalizeAd(raw) {
  const text = raw.allText || raw.details;
  const parts = raw.details.split(" | ").map((s) => s.trim());

  let area = null,
    price = null,
    rent = null,
    credit = null,
    rooms = null,
    floor = null,
    floorsCount = null,
    buildingAge = null,
    type = null,
    elevator = null,
    parking = null,
    warehouse = null,
    balcony = null,
    district = null;

  for (const part of parts) {
    const p = toEN(part);

    // Area: "۱۲۰ متر", "120 م²", "120 م2", "۱۲۰ متر مربع", "120sqm"
    const areaMatch = p.match(/(\d+)\s*(?:متر\s*مربع|م²|m²|sqm|متر|م\b)/);
    if (areaMatch) area = parseInt(areaMatch[1], 10);

    const roomMatch = p.match(/(\d+)\s*خواب/);
    if (roomMatch) rooms = parseInt(roomMatch[1], 10);
    if (p.includes("بدون خواب") || p.includes("studio")) rooms = 0;

    const floorMatch = p.match(/(?:طبقه|ط\.)\s*(\d+)/);
    if (floorMatch) floor = parseInt(floorMatch[1], 10);

    const floorsMatch = p.match(/(\d+)\s*طبقه/);
    if (floorsMatch && !floorMatch) floorsCount = parseInt(floorsMatch[1], 10);

    const ageMatch = p.match(/(\d+)\s*سال\s*ساخت/);
    if (ageMatch) buildingAge = parseInt(ageMatch[1], 10);
    if (p.includes("نوساز") || p.match(/\bنو\b/)) buildingAge = 0;

    const hasMoneyMarker = /میلیارد|میلیون|تومان|اجاره|ماهانه|رهن|ودیعه/.test(
      p,
    );
    const priceVal = hasMoneyMarker ? parsePrice(part) : null;
    if (priceVal !== null && price === null) {
      if (p.includes("اجاره") || p.includes("ماهانه")) rent = priceVal;
      else if (p.includes("رهن") || p.includes("ودیعه")) credit = priceVal;
      else price = priceVal;
    }

    if (p.includes("آپارتمان")) type = "apartment";
    else if (p.includes("ویلا")) type = "villa";
    else if (p.includes("خانه") || p.includes("ویلایی")) type = "house";
    else if (p.includes("زمین")) type = "land";
    else if (p.includes("اداری")) type = "office";
    else if (p.includes("مغازه")) type = "store";

    if (p.includes("آسانسور")) elevator = true;
    if (p.includes("پارکینگ")) parking = true;
    if (p.includes("انباری")) warehouse = true;
    if (p.includes("بالکن")) balcony = true;

    if (
      p.match(
        /گرگان|تهران|شیراز|اصفهان|مشهد|تبریز|اهواز|رشت|کیش|کرج|قم|اراک|کرمان|یزد|زاهدان|ارومیه|همدان/,
      )
    ) {
      district = part;
    }
  }

  // Fallback: search full text for area if not found in parts
  if (area === null) {
    const fullTextEN = toEN(text);
    const fullAreaMatch = fullTextEN.match(
      /(\d+)\s*(?:متر\s*مربع|م²|m²|sqm|متر|م\b)/,
    );
    if (fullAreaMatch) area = parseInt(fullAreaMatch[1], 10);
  }

  // Fallback: search full text for rooms if not found
  if (rooms === null) {
    const fullTextEN = toEN(text);
    const fullRoomMatch = fullTextEN.match(/(\d+)\s*خواب/);
    if (fullRoomMatch) rooms = parseInt(fullRoomMatch[1], 10);
  }

  // Fallback: search full text for type if not found
  if (type === null) {
    const t = toEN(text);
    if (t.includes("آپارتمان")) type = "apartment";
    else if (t.includes("ویلا")) type = "villa";
    else if (t.includes("خانه") || t.includes("ویلایی")) type = "house";
  }

  if (
    price === null &&
    /میلیارد|میلیون|تومان|اجاره|ماهانه|رهن|ودیعه/.test(raw.title)
  ) {
    const titlePrice = parsePrice(raw.title);
    if (titlePrice !== null) price = titlePrice;
  }

  return {
    id: raw.link,
    title: raw.title,
    link: raw.link,
    details: raw.details,
    area,
    price,
    rent,
    credit,
    rooms,
    floor,
    floorsCount,
    buildingAge,
    type,
    elevator,
    parking,
    warehouse,
    balcony,
    district,
    raw_details: raw.details,
    checked_at: new Date().toISOString(),
  };
}

function deduplicateAds(ads) {
  const seen = new Set();
  return ads.filter((ad) => {
    if (seen.has(ad.link)) return false;
    seen.add(ad.link);
    return true;
  });
}

async function collectAds(page, capturedAds = null) {
  const raw = capturedAds || (await extractRawAds(page));
  const normalized = raw.map(normalizeAd);
  const unique = deduplicateAds(normalized);
  console.log(`[Scraper] ${raw.length} raw -> ${unique.length} unique`);
  // Debug: show first 3 ads' raw text and parsed fields
  for (let i = 0; i < Math.min(3, raw.length); i++) {
    console.log(`[Debug Ad ${i + 1}] title: "${raw[i].title}"`);
    console.log(
      `[Debug Ad ${i + 1}] allText: "${raw[i].allText.replace(/\n/g, " | ")}"`,
    );
    console.log(
      `[Debug Ad ${i + 1}] parsed: area=${normalized[i].area}, price=${normalized[i].price}, rooms=${normalized[i].rooms}, type=${normalized[i].type}`,
    );
  }
  return unique;
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    pageInstance = null;
  }
}

export {
  ensureBrowser,
  navigateToSearch,
  scrollToLoadAds,
  extractRawAds,
  collectAds,
  normalizeAd,
  deduplicateAds,
  humanScroll,
  closeBrowser,
};
