require("dotenv").config();
const WebSocket = require("ws");
const scraper = require("./scrape_divar_ads");

const PORT = 8080;
const MONITOR_INTERVAL_MS = 30000;
const SCREENSHOT_QUALITY = 60;

const wss = new WebSocket.Server({ port: PORT });
console.log(`WebSocket server is running on ws://localhost:${PORT}`);

const shared = {
  seenAds: new Set(),
  monitor: null,
  lastFilters: {},
  busy: false,
  adCount: 0,
};

wss.on("connection", async (ws) => {
  console.log(`New client connected! (${wss.clients.size} total)`);

  try {
    const page = await scraper.ensureBrowser().then((b) => b.page);
    if (page && !page.isClosed()) {
      broadcastStatus(
        "browser",
        "done",
        "مرورگر در حال کار است — نمای زنده نمایش داده میشود",
      );
      await sendScreenshotToClient(ws, "نمای فعلی مرورگر");
    } else {
      broadcastStatus("browser", "info", "در انتظار اولین درخواست جستجو...");
    }
  } catch (e) {
    broadcastStatus("browser", "info", "در انتظار اولین درخواست جستجو...");
  }

  ws.on("message", (message) => handleMessage(ws, message));
  ws.on("close", () =>
    console.log(`Client disconnected. (${wss.clients.size} left)`),
  );
});

async function handleMessage(ws, message) {
  try {
    const data = JSON.parse(message.toString());

    if (data.action === "load_more") {
      if (shared.busy) return sendInfo(ws, "صبر کنید — در حال انجام عملیات هستم...");
      await handleLoadMore(ws);
      return;
    }

    if (data.text) {
      if (shared.busy) return sendInfo(ws, "صبر کنید — در حال انجام عملیات هستم...");
      await handleSearch(ws, data);
    }
  } catch (error) {
    console.error("Message handling error:", error.message);
  }
}

async function handleLoadMore(ws) {
  const page = await scraper.ensureBrowser().then((b) => b.page);
  if (!page) return sendInfo(ws, "اول یک جستجو انجام بدهید.");

  shared.busy = true;
  try {
    sendInfo(ws, "در حال اسکرول و دریافت آگهیهای بیشتر...");
    broadcastStatus("scroll", "running", "در حال اسکرول...");

    await scraper.scrollToLoadAds(page, {
      onProgress: ({ round, maxRounds, cardsVisible }) => {
        const progress = Math.round((round / maxRounds) * 100);
        broadcastStatus(
          "scroll",
          "running",
          `${cardsVisible} کارت قابل مشاهده`,
          progress,
        );
      },
    });

    const allAds = await scraper.extractAds(page);
    const newAds = allAds.filter((ad) => {
      if (!shared.seenAds.has(ad.link) && ad.link !== "https://divar.ir#") {
        shared.seenAds.add(ad.link);
        return true;
      }
      return false;
    });

    if (newAds.length > 0) {
      broadcastStatus("scroll", "done", `${newAds.length} آگهی جدید پیدا شد`);
      ws.send(JSON.stringify({ type: "results", data: newAds }));
    } else {
      broadcastStatus("scroll", "done", "آگهی جدیدی پیدا نشد");
      sendInfo(ws, "فعلا آگهی جدیدی یافت نشد.");
    }
  } finally {
    shared.busy = false;
  }
}

async function handleSearch(ws, data) {
  const filters = {
    query: data.text,
    price_min: data.price_min || shared.lastFilters.price_min || null,
    price_max: data.price_max || shared.lastFilters.price_max || null,
  };
  shared.lastFilters = filters;

  let filterInfo = `جستجو: "${filters.query}"`;
  if (filters.price_min)
    filterInfo += ` | از ${(filters.price_min / 1e9).toFixed(1)} میلیارد`;
  if (filters.price_max)
    filterInfo += ` | تا ${(filters.price_max / 1e9).toFixed(1)} میلیارد`;
  sendInfo(ws, filterInfo);

  shared.busy = true;
  shared.seenAds.clear();

  try {
    broadcastStatus("navigate", "running", "در حال باز کردن صفحه دیوار...");
    const page = await scraper.performSearch(filters);
    broadcastStatus("navigate", "done", "صفحه دیوار بارگذاری شد");
    await sendScreenshot("صفحه بارگذاری شد");

    broadcastStatus("extract", "running", "در حال استخراج آگهیها...");
    await scraper.scrollToLoadAds(page, {
      onProgress: ({ round, maxRounds, cardsVisible }) => {
        const progress = Math.round((round / maxRounds) * 100);
        broadcastStatus(
          "scroll",
          "running",
          `${cardsVisible} کارت قابل مشاهده`,
          progress,
        );
      },
    });

    const ads = await scraper.extractAds(page);
    const newAds = ads.filter((ad) => {
      if (!shared.seenAds.has(ad.link) && ad.link !== "https://divar.ir#") {
        shared.seenAds.add(ad.link);
        return true;
      }
      return false;
    });

    shared.adCount = newAds.length;
    broadcastStatus("extract", "done", `${newAds.length} آگهی استخراج شد`);
    ws.send(
      JSON.stringify({ type: "results", data: newAds, isNewSearch: true }),
    );
    ws.send(JSON.stringify({ type: "ad-count", count: newAds.length }));
    startMonitoring();
  } finally {
    shared.busy = false;
  }
}

function sendInfo(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "info", message }));
  }
}

function broadcastStatus(step, status, message, progress = null) {
  const payload = JSON.stringify({
    type: "status",
    step,
    status,
    message,
    progress,
  });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function broadcastLog(kind, text) {
  const payload = JSON.stringify({ type: "log", kind, text });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

async function sendScreenshot(label = "") {
  const page = await scraper.ensureBrowser().then((b) => b.page);
  if (!page) return;
  try {
    const buffer = await page.screenshot({
      type: "jpeg",
      quality: SCREENSHOT_QUALITY,
    });
    const base64 = buffer.toString("base64");
    const payload = JSON.stringify({
      type: "screenshot",
      label,
      image: base64,
      url: page.url(),
      timestamp: Date.now(),
    });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  } catch (e) {
    // Screenshot can fail if page is navigating, ignore silently
  }
}

async function sendScreenshotToClient(ws, label = "") {
  const page = await scraper.ensureBrowser().then((b) => b.page);
  if (!page) return;
  try {
    const buffer = await page.screenshot({
      type: "jpeg",
      quality: SCREENSHOT_QUALITY,
    });
    const base64 = buffer.toString("base64");
    ws.send(
      JSON.stringify({
        type: "screenshot",
        label,
        image: base64,
        url: page.url(),
        timestamp: Date.now(),
      }),
    );
  } catch (e) {
    // ignore
  }
}

function startMonitoring() {
  if (shared.monitor) clearInterval(shared.monitor);

  console.log("[Monitor] Started background checking every 30 seconds...");
  broadcastStatus(
    "monitor",
    "running",
    "مانیتورینگ فعال شد — بررسی هر ۳۰ ثانیه",
  );

  shared.monitor = setInterval(async () => {
    try {
      console.log("[Monitor] Checking for new ads in background...");
      broadcastStatus("monitor", "info", "بررسی آگهیهای جدید...");

      const page = await scraper.ensureBrowser().then((b) => b.page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      await sendScreenshot("بررسی دورهای");

      const allAds = await scraper.extractAds(page);
      const newAds = allAds.filter((ad) => {
        if (!shared.seenAds.has(ad.link) && ad.link !== "https://divar.ir#") {
          shared.seenAds.add(ad.link);
          return true;
        }
        return false;
      });

      if (newAds.length > 0) {
        console.log(
          `[Monitor] Found ${newAds.length} NEW ads! Sending notification...`,
        );
        broadcastStatus(
          "monitor",
          "done",
          `${newAds.length} آگهی جدید پیدا شد!`,
        );
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "notification", data: newAds }));
          }
        }
      } else {
        broadcastStatus(
          "monitor",
          "running",
          "مانیتورینگ فعال — آگهی جدیدی نیست",
        );
      }
    } catch (error) {
      console.error("[Monitor] Error during background check:", error.message);
      broadcastStatus("monitor", "error", `خطا در بررسی: ${error.message}`);
    }
  }, MONITOR_INTERVAL_MS);
}
