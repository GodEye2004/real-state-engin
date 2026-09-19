require("dotenv").config();
const WebSocket = require("ws");
const { parseSearchPrompt } = require("./search_parser");
const { buildDivarRequest, applyPostFilters } = require("./divar_adapter");
const scraper = require("./scrape_divar_ads");

const PORT = 8080;
const MONITOR_INTERVAL_MS = 30000;
const SCREENSHOT_QUALITY = 60;

const wss = new WebSocket.Server({ port: PORT });
console.log(`WebSocket server is running on ws://localhost:${PORT}`);

const shared = {
  seenAds: new Set(),
  monitor: null,
  lastSearch: null,
  lastPostFilters: null,
  busy: false,
  adCount: 0,
};

wss.on("connection", async (ws) => {
  console.log(`New client connected! (${wss.clients.size} total)`);
  try {
    const { page } = await scraper.ensureBrowser();
    if (page && !page.isClosed()) {
      broadcastStatus("browser", "done", "مرورگر در حال کار است");
      await sendScreenshotToClient(ws, "نمای فعلی مرورگر");
    } else {
      broadcastStatus("browser", "info", "در انتظار اولین درخواست جستجو...");
    }
  } catch {
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
      if (shared.busy) return sendInfo(ws, "صبر کنید...");
      await handleLoadMore(ws);
      return;
    }
    if (data.action === "structured_search") {
      if (shared.busy) return sendInfo(ws, "صبر کنید...");
      await handleStructuredSearch(ws, data);
      return;
    }
    if (data.text) {
      if (shared.busy) return sendInfo(ws, "صبر کنید...");
      await handleSearch(ws, data.text);
    }
  } catch (error) {
    console.error("Message handling error:", error.message);
  }
}

/**
 * Structured search: user fills form, data goes straight to Divar (no AI parsing).
 */
async function handleStructuredSearch(ws, formData) {
  shared.busy = true;
  shared.seenAds.clear();

  try {
    // Build search object directly from form data — no AI needed
    const search = {
      city: formData.city || "gorgan",
      category: formData.category || "buy-apartment",
      type: formData.type || null,
      rooms: formData.rooms || null,
      size_min: formData.size_min || null,
      size_max: formData.size_max || null,
      price_min: formData.price_min || null,
      price_max: formData.price_max || null,
      rent_min: formData.rent_min || null,
      rent_max: formData.rent_max || null,
      credit_min: formData.credit_min || null,
      credit_max: formData.credit_max || null,
      elevator: formData.elevator || null,
      parking: formData.parking || null,
      warehouse: formData.warehouse || null,
      query: formData.query || null,
    };
    shared.lastSearch = search;
    console.log(
      "[Pipeline] Structured search:",
      JSON.stringify(search, null, 2),
    );

    // Build Divar URL directly — skip AI parse step
    const { url, postFilters } = buildDivarRequest(search);
    shared.lastPostFilters = postFilters;
    broadcastStatus("adapt", "done", "آدرس ساخته شد");
    console.log("[Pipeline] URL:", url);

    // Navigate
    broadcastStatus("navigate", "running", "باز کردن صفحه دیوار...");
    const page = await scraper.navigateToSearch(url);
    broadcastStatus("navigate", "done", "صفحه دیوار بارگذاری شد");
    await sendScreenshot("صفحه بارگذاری شد");

    // Scroll
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

    // Collect + normalize + dedupe + post-filter
    broadcastStatus("collect", "running", "جمع‌آوری آگهیها...");
    let ads = await scraper.collectAds(page);
    console.log(`[Pipeline] Before post-filter: ${ads.length} ads`);
    ads = applyPostFilters(ads, postFilters);
    console.log(`[Pipeline] After post-filter: ${ads.length} ads`);

    shared.adCount = ads.length;
    broadcastStatus("collect", "done", `${ads.length} آگهی یافت شد`);
    ws.send(JSON.stringify({ type: "results", data: ads, isNewSearch: true }));
    ws.send(JSON.stringify({ type: "ad-count", count: ads.length }));

    startMonitoring();
  } catch (error) {
    console.error("[Pipeline] Error:", error.message);
    sendInfo(ws, `خطا: ${error.message}`);
    broadcastStatus("error", "error", `خطا: ${error.message}`);
  } finally {
    shared.busy = false;
  }
}

async function handleSearch(ws, userPrompt) {
  shared.busy = true;
  shared.seenAds.clear();

  try {
    // Step 1: Parse user prompt
    broadcastStatus("parse", "running", "تحلیل درخواست...");
    sendInfo(ws, "در حال تحلیل درخواست شما...");
    const search = await parseSearchPrompt(userPrompt);
    shared.lastSearch = search;
    broadcastStatus("parse", "done", "درخواست تحلیل شد");
    console.log("[Pipeline] Parsed:", JSON.stringify(search, null, 2));

    // Step 2: Build Divar URL
    const { url, postFilters } = buildDivarRequest(search);
    shared.lastPostFilters = postFilters;
    broadcastStatus("adapt", "done", "آدرس ساخته شد");
    console.log("[Pipeline] URL:", url);
    console.log("[Pipeline] Post-filters:", JSON.stringify(postFilters));

    // Step 3: Navigate
    broadcastStatus("navigate", "running", "باز کردن صفحه دیوار...");
    const page = await scraper.navigateToSearch(url);
    broadcastStatus("navigate", "done", "صفحه دیوار بارگذاری شد");
    await sendScreenshot("صفحه بارگذاری شد");

    // Step 4: Scroll
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

    // Step 5: Collect + normalize + dedupe
    broadcastStatus("collect", "running", "جمع‌آوری آگهیها...");
    let ads = await scraper.collectAds(page);
    console.log(`[Pipeline] Before post-filter: ${ads.length} ads`);

    // Step 6: Post-filter for extra precision
    ads = applyPostFilters(ads, postFilters);
    console.log(`[Pipeline] After post-filter: ${ads.length} ads`);

    shared.adCount = ads.length;
    broadcastStatus("collect", "done", `${ads.length} آگهی دقیق یافت شد`);
    ws.send(JSON.stringify({ type: "results", data: ads, isNewSearch: true }));
    ws.send(JSON.stringify({ type: "ad-count", count: ads.length }));

    startMonitoring();
  } catch (error) {
    console.error("[Pipeline] Error:", error.message);
    sendInfo(ws, `خطا: ${error.message}`);
    broadcastStatus("error", "error", `خطا: ${error.message}`);
  } finally {
    shared.busy = false;
  }
}

async function handleLoadMore(ws) {
  const { page } = await scraper.ensureBrowser();
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

    let ads = await scraper.collectAds(page);
    ads = applyPostFilters(ads, shared.lastPostFilters);

    const newAds = ads.filter((ad) => {
      if (!shared.seenAds.has(ad.link)) {
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

async function sendScreenshot(label = "") {
  const { page } = await scraper.ensureBrowser();
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
  } catch {
    // ignore
  }
}

async function sendScreenshotToClient(ws, label = "") {
  const { page } = await scraper.ensureBrowser();
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
  } catch {
    // ignore
  }
}

function startMonitoring() {
  if (shared.monitor) clearInterval(shared.monitor);

  console.log("[Monitor] Started background checking every 30 seconds...");
  broadcastStatus("monitor", "running", "مانیتورینگ فعال — بررسی هر ۳۰ ثانیه");

  shared.monitor = setInterval(async () => {
    try {
      console.log("[Monitor] Checking for new ads...");
      broadcastStatus("monitor", "info", "بررسی آگهیهای جدید...");

      const { page } = await scraper.ensureBrowser();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      await sendScreenshot("بررسی دورهای");

      let ads = await scraper.collectAds(page);
      ads = applyPostFilters(ads, shared.lastPostFilters);

      const newAds = ads.filter((ad) => {
        if (!shared.seenAds.has(ad.link)) {
          shared.seenAds.add(ad.link);
          return true;
        }
        return false;
      });

      if (newAds.length > 0) {
        console.log(`[Monitor] Found ${newAds.length} NEW ads!`);
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
        broadcastStatus("monitor", "running", "مانیتورینگ — آگهی جدیدی نیست");
      }
    } catch (error) {
      console.error("[Monitor] Error:", error.message);
      broadcastStatus("monitor", "error", `خطا: ${error.message}`);
    }
  }, MONITOR_INTERVAL_MS);
}
