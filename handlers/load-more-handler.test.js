import assert from "node:assert/strict";
import test from "node:test";
import { createLoadMoreHandler } from "./load-more-handler.js";
import { scoreAds } from "../services/ads/ad_match_scorer.js";
import { applyPostFilters } from "../services/divar/divar_adapter.js";

test("load more sends unseen ads and maintains the cumulative count", async () => {
    const capturedAds = [
        { id: "seen", link: "seen", price: 7_000_000_000, area: 120 },
        {
            id: "near-match",
            link: "near-match",
            price: 9_500_000_000,
            area: 130,
        },
        { id: "new", link: "new", price: 7_500_000_000, area: 115 },
    ];
    const userState = {
        seenAds: new Set(["seen"]),
        searchId: "search-1",
        search: { price_max: 8_000_000_000 },
        postFilters: { price_max: 8_000_000_000, size_min: 110 },
        adCount: 1,
    };
    const shared = { busy: false };
    const messages = [];
    let savedResults;
    const handler = createLoadMoreHandler({
        scraper: {
            navigateToSearch: async (url) => {
                assert.equal(url, "https://divar.test/user-search");
                return {};
            },
            scrollToLoadAds: async (_page, options) => {
                assert.equal(options.maxRounds, 10);
                return capturedAds;
            },
            collectAds: async (_page, ads) => ads,
        },
        shared,
        buildDivarRequest: () => ({ url: "https://divar.test/user-search" }),
        applyPostFilters,
        scoreAds,
        broadcastStatus: () => {},
        sendInfo: () => {},
        getUserState: () => userState,
        saveSearchResults: async (data) => {
            savedResults = data;
        },
    });

    await handler({
        userId: "user-1",
        sessionId: "session-1",
        send: (message) => messages.push(JSON.parse(message)),
    });

    const results = messages.find((message) => message.type === "results");
    const count = messages.find((message) => message.type === "ad-count");
    assert.deepEqual(
        results.data.map((ad) => ad.id),
        ["new", "near-match"],
    );
    assert.equal(count.count, 3);
    assert.equal(userState.seenAds.has("near-match"), true);
    assert.equal(savedResults.searchId, "search-1");
    assert.equal(savedResults.userId, "user-1");
    assert.deepEqual(
        savedResults.ads.map((ad) => ad.id),
        ["new", "near-match"],
    );
    assert.equal(shared.busy, false);
});
