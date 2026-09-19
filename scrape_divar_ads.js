const { chromium } = require("playwright");

const DIVAR_BASE_URL = "https://divar.ir/s/gorgan/real-estate";
const AD_LINK_PATTERN = 'a[href*="/v/"]';
const MAX_SCROLL_ROUNDS = 30;
const SCROLL_WAIT_MS = 2000;
const PAGE_LOAD_WAIT_MS = 5000;

let browserInstance = null;
let pageInstance = null;

async function ensureBrowser() {
  if (browserInstance) return { browser: browserInstance, page: pageInstance };
  browserInstance = await chromium.launch({ headless: false });
  const context = await browserInstance.newContext({
    viewport: { width: 1280, height: 850 },
  });
  pageInstance = await context.newPage();
  return { browser: browserInstance, page: pageInstance };
}

async function performSearch(filters = {}) {
  const { page } = await ensureBrowser();

  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.price_min) params.set("price_min", filters.price_min);
  if (filters.price_max) params.set("price_max", filters.price_max);
  params.set("cat", "residential-buy");

  const url = `${DIVAR_BASE_URL}?${params.toString()}`;
  console.log(`[Scraper] Navigating to: ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(PAGE_LOAD_WAIT_MS);
  console.log("[Scraper] Page loaded.");
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

function extractAds(page) {
  return page.$$eval(AD_LINK_PATTERN, (anchors) =>
    anchors.map((el) => {
      const lines = el.innerText.split("\n").filter((t) => t.trim() !== "");
      const title = lines[0] || "بدون عنوان";
      const href = el.getAttribute("href") || "#";
      const link = href.startsWith("http") ? href : `https://divar.ir${href}`;
      return { title, link, details: lines.slice(1).join(" | ") };
    }),
  );
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    pageInstance = null;
  }
}

module.exports = {
  ensureBrowser,
  performSearch,
  scrollToLoadAds,
  extractAds,
  humanScroll,
  closeBrowser,
};
