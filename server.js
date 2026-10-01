import dotenv from "dotenv";
import { createServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import {
  buildDivarRequest,
  applyPostFilters,
} from "./services/divar/divar_adapter.js";
import * as scraper from "./services/divar/scrape_divar_ads.js";
import { sendScreenshot } from "./services/divar/screenshot.js";
import { createMonitor } from "./monitoring_service/start_monitoring.js";
import { normalizeSearchInput } from "./services/search/search_normalizer.js";
import { scoreAds } from "./services/ads/ad_match_scorer.js";
import { parseSearchPrompt } from "./services/ai/search_parser.js";
import { setupWebSocket } from "./websocket.js";
import { createLoadMoreHandler } from "./handlers/load-more-handler.js";
import { createStructuredSearchHandler } from "./handlers/search-handler.js";
import {
  connectDatabase,
  createDatabaseClient,
} from "./services/database/database.js";
import {
  closeUserSession,
  createSearchRecord,
  persistSearchResults,
} from "./services/database/persistence.js";
import { createAuthHandler } from "./handlers/auth-handler.js";
import { handleHttpRequest } from "./api_docs/http-handler.js";

dotenv.config();

const prisma = createDatabaseClient();
const handleAuth = createAuthHandler({
  prisma,
  allowMockOtp:
    process.env.NODE_ENV !== "production" || process.env.OTP_MODE === "mock",
  onSessionClosed: (sessionId) => shared.activeSearches.delete(sessionId),
});
const PORT = Number(process.env.PORT || 8080);
const MONITOR_INTERVAL_MS = 30000;
// const SCREENSHOT_QUALITY = 60;

const server = createServer(handleHttpRequest);
const wss = new WebSocketServer({ server });

server.listen(PORT, "0.0.0.0", () => {
  console.log(`WebSocket server is running on ws://0.0.0.0:${PORT}`);
});

connectDatabase(prisma).catch((error) => {
  console.error("[Database] PostgreSQL connection failed:", error.message);
});

function broadcastStatus(
  step,
  status,
  message,
  progress = null,
  recipient = null,
) {
  const payload = {
    type: "status",
    step,
    status,
    message,
    progress,
  };

  const data = JSON.stringify(payload);

  const recipients = recipient ? [recipient] : wss.clients;
  recipients.forEach((client) => {
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
  activeSearches: new Map(),
  monitor: null,
  busy: false,
};

function getUserState(ws) {
  if (
    !ws.userState ||
    ws.userState.userId !== ws.userId ||
    ws.userState.sessionId !== ws.sessionId
  ) {
    ws.userState = {
      userId: ws.userId,
      sessionId: ws.sessionId,
      searchId: null,
      search: null,
      postFilters: null,
      seenAds: new Set(),
      adCount: 0,
    };
  }

  return ws.userState;
}

const monitor = createMonitor({
  shared,
  scraper,
  wss,
  broadcastStatus,
  buildDivarRequest,
  applyPostFilters,
  scoreAds,
  saveSearchResults: (data) => persistSearchResults(prisma, data),
  monitorIntervalMs: MONITOR_INTERVAL_MS,
});

monitor.startMonitoring();

const handleLoadMore = createLoadMoreHandler({
  scraper,
  shared,
  buildDivarRequest,
  applyPostFilters,
  scoreAds,
  broadcastStatus,
  sendInfo,
  getUserState,
  saveSearchResults: (data) => persistSearchResults(prisma, data),
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
  sendScreenshot: (label, ws) => sendScreenshot(scraper, wss, label, ws),
  startMonitoring: monitor.startMonitoring,
  getUserState,
  createSearch: (data) => createSearchRecord(prisma, data),
  saveSearchResults: (data) => persistSearchResults(prisma, data),
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
  closeSession: async ({ sessionId, userId }) => {
    shared.activeSearches.delete(sessionId);
    return closeUserSession(prisma, { sessionId, userId });
  },
  apiHandlers: {
    auth: handleAuth,
    loadMore: (ws) => handleLoadMore(ws),
    structuredSearch: (ws, data) => handleStructuredSearch(ws, data),
    textSearch: (ws, data) => handleSearch(ws, data.text),
  },
});
