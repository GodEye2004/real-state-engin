require("dotenv").config();
const WebSocket = require("ws");
const { chromium } = require("playwright");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const wss = new WebSocket.Server({ port: 8080 });
console.log("WebSocket server is running on ws://localhost:8080");

const SYSTEM_PROMPT = `
You are a smart real estate assistant for Divar (Gorgan). You speak Persian.
You MUST always respond in valid JSON format with exactly two keys: "reply" and "search_query".
- "reply": A friendly, natural response to the user in Persian.
- "search_query": If the user is asking for a property or modifying their previous request, provide a short 1-4 word Persian search phrase perfect for a search bar. If no new search is needed, set this to null.
`;

wss.on("connection", (ws) => {
  console.log("New client connected!");

  ws.chatHistory = [{ role: "system", content: SYSTEM_PROMPT }];
  ws.browser = null;
  ws.page = null;
  ws.seenAds = new Set();
  ws.monitorInterval = null; // Background monitoring loop

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.action === "load_more") {
        if (!ws.page) return;
        ws.send(
          JSON.stringify({
            type: "info",
            message: "در حال اسکرول و دریافت آگهی‌های بیشتر...",
          }),
        );

        const newAds = await extractMoreAds(ws);
        if (newAds.length > 0) {
          ws.send(JSON.stringify({ type: "results", data: newAds }));
        } else {
          ws.send(
            JSON.stringify({
              type: "info",
              message: "فعلا آگهی جدیدی در صفحات پایین‌تر یافت نشد.",
            }),
          );
        }
        return;
      }

      if (data.text) {
        const rawQuery = data.text;
        ws.chatHistory.push({ role: "user", content: rawQuery });
        ws.send(
          JSON.stringify({ type: "info", message: "در حال فکر کردن..." }),
        );

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: ws.chatHistory,
          response_format: { type: "json_object" },
          max_tokens: 150,
          temperature: 0.2,
        });

        const parsedResponse = JSON.parse(
          completion.choices[0].message.content,
        );
        ws.chatHistory.push({
          role: "assistant",
          content: completion.choices[0].message.content,
        });
        ws.send(
          JSON.stringify({ type: "info", message: parsedResponse.reply }),
        );

        if (parsedResponse.search_query) {
          const query = parsedResponse.search_query;
          ws.send(
            JSON.stringify({
              type: "info",
              message: `🔍 شروع جستجو و مانیتورینگ برای: "${query}"`,
            }),
          );

          await performNewSearch(ws, query);
          const results = await extractMoreAds(ws, false);
          ws.send(
            JSON.stringify({
              type: "results",
              data: results,
              isNewSearch: true,
            }),
          );

          // Start background monitoring!
          startMonitoring(ws);
        }
      }
    } catch (e) {
      console.error(e);
    }
  });

  ws.on("close", async () => {
    console.log("Client disconnected. Cleaning up...");
    if (ws.monitorInterval) clearInterval(ws.monitorInterval);
    if (ws.browser) await ws.browser.close();
  });
});

async function performNewSearch(ws, query) {
  if (!ws.browser) {
    ws.browser = await chromium.launch({ headless: true });
    const context = await ws.browser.newContext();
    ws.page = await context.newPage();
  }

  if (ws.monitorInterval) {
    clearInterval(ws.monitorInterval);
  }

  ws.seenAds.clear();
  await ws.page.goto("https://divar.ir/s/gorgan/buy-residential", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await ws.page.waitForTimeout(3000);

  const searchBox = await ws.page.locator('input[placeholder*="جستجو"]');
  await searchBox.fill(query);
  await searchBox.press("Enter");
  await ws.page.waitForTimeout(3000);
}

async function extractMoreAds(ws, shouldScroll = true) {
  if (shouldScroll) {
    console.log(`[Scraper] Scrolling down to load data...`);
    let previousCount = 0;
    
    // Loop to scroll deeply and load a LOT of ads
    for (let i = 0; i < 8; i++) { 
      const adElements = await ws.page.$$('a[href*="/v/"]');
      if (adElements.length > 0) {
        // Force the sidebar to scroll by targeting the very last loaded ad
        const lastAd = adElements[adElements.length - 1];
        await lastAd.scrollIntoViewIfNeeded();
      }
      
      // Wait for Divar to fetch new ads from their database
      await ws.page.waitForTimeout(2000); 
      
      // Check if new ads actually loaded, if not, stop scrolling
      const newCount = (await ws.page.$$('a[href*="/v/"]')).length;
      if (newCount === previousCount) {
        console.log(`[Scraper] Reached the end or no more ads loading.`);
        break;
      }
      previousCount = newCount;
    }
  }

  const ads = await ws.page.$$eval('a[href*="/v/"]', (elements) => {
    return elements.map((el) => {
      const textContent = el.innerText
        .split("\n")
        .filter((t) => t.trim() !== "");
      const title = textContent[0] || "Unknown Title";
      const href = el.getAttribute("href");
      const link = href.startsWith("http") ? href : `https://divar.ir${href}`;
      return { title, link, details: textContent.slice(1).join(" | ") };
    });
  });

  const newAds = [];
  for (const ad of ads) {
    if (!ws.seenAds.has(ad.link)) {
      ws.seenAds.add(ad.link);
      newAds.push(ad);
    }
  }
  return newAds;
}

function startMonitoring(ws) {
  console.log(`[Monitor] Started background checking every 30 seconds...`);

  ws.monitorInterval = setInterval(async () => {
    try {
      console.log(`[Monitor] Checking for new ads in background...`);
      // Reload the page to get the freshest top results
      await ws.page.reload({ waitUntil: "domcontentloaded" });
      await ws.page.waitForTimeout(4000);

      const newAds = await extractMoreAds(ws, false); // Don't scroll, just check top ones

      if (newAds.length > 0) {
        console.log(
          `[Monitor] Found ${newAds.length} NEW ads! Sending notification...`,
        );
        ws.send(JSON.stringify({ type: "notification", data: newAds }));
      }
    } catch (error) {
      console.error("[Monitor] Error during background check:", error.message);
    }
  }, 30000); // 30 seconds for testing (in reality, maybe 5 minutes)
}
