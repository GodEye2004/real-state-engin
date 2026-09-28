import dotenv from "dotenv";
import { createServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import {
  buildDivarRequest,
  applyPostFilters,
} from "./services/divar_adapter.js";
import * as scraper from "./services/scrape_divar_ads.js";
import { sendScreenshot } from "./services/screenshot.js";
import { createMonitor } from "./services/start_monitoring.js";
import { normalizeSearchInput } from "./services/search_normalizer.js";
import { scoreAds } from "./services/ad_match_scorer.js";
import { parseSearchPrompt } from "./services/search_parser.js";
import { setupWebSocket } from "./websocket.js";
import { createLoadMoreHandler } from "./handlers/load-more-handler.js";
import { createStructuredSearchHandler } from "./handlers/search-handler.js";

dotenv.config();

const PORT = Number(process.env.PORT || 8080);
const MONITOR_INTERVAL_MS = 30000;
// const SCREENSHOT_QUALITY = 60;

const server = createServer();
const wss = new WebSocketServer({ server });

server.listen(PORT, "0.0.0.0", () => {
  console.log(`WebSocket server is running on ws://0.0.0.0:${PORT}`);
});

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

const shared = {
  seenAds: new Set(),
  monitor: null,
  lastSearch: null,
  lastPostFilters: null,
  busy: false,
  adCount: 0,
};

const monitor = createMonitor({
  shared,
  scraper,
  wss,
  broadcastStatus,
  buildDivarRequest,
  applyPostFilters,
  scoreAds,
  monitorIntervalMs: MONITOR_INTERVAL_MS,
});

monitor.startMonitoring();

const handleLoadMore = createLoadMoreHandler({
  scraper,
  shared,
  applyPostFilters,
  scoreAds,
  broadcastStatus,
  sendInfo,
});

const handleStructuredSearch = createStructuredSearchHandler({
  scraper,
  shared,
  buildDivarRequest,
  applyPostFilters,
  scoreAds,
  normalizeSearchInput,
  broadcastStatus,
  sendInfo,
  sendScreenshot: (label) => sendScreenshot(scraper, wss, label),
  startMonitoring: monitor.startMonitoring,
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// Free text → LLM parses sale/rent, price, area, amenities → same pipeline.
const handleSearch = async (ws, text) => {
  shared.busy = true;

  let parsed = null;

  try {
    parsed = await withTimeout(parseSearchPrompt(text), 15000);
  } catch (error) {
    console.warn("[Pipeline] Query parsing failed:", error.message);
  }

  return handleStructuredSearch(ws, {
    ...(parsed || {}),
    query: parsed?.query || text,
  });
};

setupWebSocket({
  wss,
  scraper,
  shared,
  broadcastStatus,
  sendInfo,
  handleLoadMore,
  handleStructuredSearch,
  handleSearch,
});
