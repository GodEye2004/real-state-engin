import assert from "node:assert/strict";
import WebSocket from "ws";
import test from "node:test";
import { createMonitor } from "./start_monitoring.js";

test("monitor persists new ads to each search and notifies only its socket", async () => {
    let runCycle;
    const saved = [];
    const ownerMessages = [];
    const otherMessages = [];
    const ad = { id: "ad-1", link: "ad-1", price: 5000000000 };
    const searchState = {
        userId: "user-1",
        sessionId: "session-1",
        searchId: "search-1",
        search: { city: "gorgan" },
        postFilters: {},
        seenAds: new Set(),
        adCount: 0,
    };
    const shared = {
        busy: false,
        activeSearches: new Map([[searchState.sessionId, searchState]]),
    };
    const ownerSocket = {
        readyState: WebSocket.OPEN,
        sessionId: "session-1",
        send: (message) => ownerMessages.push(JSON.parse(message)),
    };
    const otherSocket = {
        readyState: WebSocket.OPEN,
        sessionId: "session-2",
        send: (message) => otherMessages.push(JSON.parse(message)),
    };
    const monitor = createMonitor({
        shared,
        scraper: {
            navigateToSearch: async () => ({}),
            collectAds: async () => [ad],
        },
        wss: { clients: new Set([ownerSocket, otherSocket]) },
        broadcastStatus: () => {},
        buildDivarRequest: () => ({ url: "https://divar.test" }),
        applyPostFilters: (ads) => ads,
        scoreAds: (ads) => ads.map((item) => ({ ...item, matchScore: 90 })),
        saveSearchResults: async (data) => saved.push(data),
        monitorIntervalMs: 30000,
        setIntervalFn: (callback) => {
            runCycle = callback;
            return "monitor-timer";
        },
        clearIntervalFn: () => {},
    });

    monitor.startMonitoring();
    await runCycle();
    monitor.stopMonitoring();

    assert.equal(saved.length, 1);
    assert.equal(saved[0].userId, "user-1");
    assert.equal(saved[0].searchId, "search-1");
    assert.deepEqual(
        saved[0].ads.map((item) => item.id),
        ["ad-1"],
    );
    assert.equal(searchState.adCount, 1);
    assert.equal(searchState.seenAds.has("ad-1"), true);
    assert.equal(ownerMessages[0].type, "notification");
    assert.equal(otherMessages.length, 0);
    assert.equal(shared.busy, false);
});
