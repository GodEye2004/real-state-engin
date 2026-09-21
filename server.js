require("dotenv").config();
const WebSocket = require("ws");
const { parseSearchPrompt } = require("./services/search_parser");
const {
  buildDivarRequest,
  applyPostFilters,
} = require("./services/divar_adapter");
const scraper = require("./services/scrape_divar_ads");

const PORT = 8080;
const MONITOR_INTERVAL_MS = 30000;
// const SCREENSHOT_QUALITY = 60;

const wss = new WebSocket.Server({ port: PORT });
console.log(`WebSocket server is running on ws://localhost:${PORT}`);

function broadcastStatus(step, status, message, progress = null) {
  const payload = {
    type: "status",
    step,
    status,
    message,
    progress,
  };

  const data = JSON.stringify(payload);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function sendInfo(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "info", message }));
  }
}

async function sendScreenshot(label) {
  const { page } = await scraper.ensureBrowser();
  if (!page || page.isClosed()) return;

  const image = await page.screenshot({ type: "jpeg", quality: 70 });
  const payload = JSON.stringify({
    type: "screenshot",
    image: image.toString("base64"),
    url: page.url(),
    label,
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

const shared = {
  seenAds: new Set(),
  monitor: null,
  lastSearch: null,
  lastPostFilters: null,
  busy: false,
  adCount: 0,
};

function startMonitoring() {
  if (shared.monitor) clearInterval(shared.monitor);

  console.log(
    `[Monitor] Started. Checking Divar every ${MONITOR_INTERVAL_MS / 1000} seconds...`,
  );
  broadcastStatus("monitor", "running", "جستجوی دائمی فعال است");

  shared.monitor = setInterval(async () => {
    if (shared.busy || !shared.lastSearch) return;

    try {
      const { url } = buildDivarRequest(shared.lastSearch);
      const page = await scraper.navigateToSearch(url);
      const ads = applyPostFilters(
        await scraper.collectAds(page),
        shared.lastPostFilters,
      );
      const newAds = ads.filter((ad) => {
        if (shared.seenAds.has(ad.link)) return false;
        shared.seenAds.add(ad.link);
        return true;
      });

      console.log(
        `[Monitor] Checked ${ads.length} ads, ${newAds.length} new ads found.`,
      );
      broadcastStatus(
        "monitor",
        "running",
        newAds.length
          ? `${newAds.length} آگهی جدید پیدا شد`
          : "جستجوی دائمی فعال است؛ آگهی جدیدی پیدا نشد",
      );

      if (newAds.length > 0) {
        const payload = JSON.stringify({ type: "notification", data: newAds });
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) client.send(payload);
        });
      }
    } catch (error) {
      console.error("[Monitor] Error:", error.message);
      broadcastStatus(
        "monitor",
        "error",
        `خطا در جستجوی دائمی: ${error.message}`,
      );
    }
  }, MONITOR_INTERVAL_MS);
}

// web socket connection handling
wss.on("connection", async (ws) => {
  console.log(`New client connected! (${wss.clients.size} total)`);
  try {
    const { page } = await scraper.ensureBrowser();
    if (page && !page.isClosed()) {
      broadcastStatus("browser", "done", "مرورگر در حال کار است");
      // await sendScreenshotToClient(ws, "نمای فعلی مرورگر");
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

// handle messages come from client
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

async function handleLoadMore(ws) {
  shared.busy = true;

  try {
    const { page } = await scraper.ensureBrowser();
    const capturedAds = await scraper.scrollToLoadAds(page, {
      maxRounds: 10,
      staleThreshold: 3,
      onProgress: ({ round, maxRounds, adsCollected }) => {
        const progress = Math.round((round / maxRounds) * 100);
        broadcastStatus(
          "scroll",
          "running",
          `${adsCollected || 0} آگهی جمع‌آوری شد`,
          progress,
        );
      },
    });
    const ads = applyPostFilters(
      await scraper.collectAds(page, capturedAds),
      shared.lastPostFilters,
    );

    ads.forEach((ad) => shared.seenAds.add(ad.link));
    shared.adCount = ads.length;
    broadcastStatus("collect", "done", `${ads.length} آگهی یافت شد`);
    ws.send(JSON.stringify({ type: "results", data: ads, isNewSearch: false }));
    ws.send(JSON.stringify({ type: "ad-count", count: ads.length }));
  } catch (error) {
    console.error("[Pipeline] Load more error:", error.message);
    sendInfo(ws, `خطا: ${error.message}`);
    broadcastStatus("error", "error", `خطا: ${error.message}`);
  } finally {
    shared.busy = false;
  }
}

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
    const capturedAds = await scraper.scrollToLoadAds(page, {
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
    await sendScreenshot("نتایج بارگذاری شد");

    // Collect + normalize + dedupe + post-filter
    broadcastStatus("collect", "running", "جمع‌آوری آگهیها...");
    let ads = await scraper.collectAds(page, capturedAds);
    console.log(`[Pipeline] Before post-filter: ${ads.length} ads`);
    ads = applyPostFilters(ads, postFilters);
    console.log(`[Pipeline] After post-filter: ${ads.length} ads`);

    shared.adCount = ads.length;
    ads.forEach((ad) => shared.seenAds.add(ad.link));
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
