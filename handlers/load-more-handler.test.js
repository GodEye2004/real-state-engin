import assert from "node:assert/strict";
import test from "node:test";
import { createLoadMoreHandler } from "./load-more-handler.js";
import { scoreAds } from "../services/ad_match_scorer.js";
import { applyPostFilters } from "../services/divar_adapter.js";

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
    const shared = {
        busy: false,
        seenAds: new Set(["seen"]),
        lastSearch: { price_max: 8_000_000_000 },
        lastPostFilters: { price_max: 8_000_000_000, size_min: 110 },
        adCount: 1,
    };
    const messages = [];
    const handler = createLoadMoreHandler({
        scraper: {
            ensureBrowser: async () => ({ page: {} }),
            scrollToLoadAds: async (_page, options) => {
                assert.equal(options.maxRounds, 10);
                return capturedAds;
            },
            collectAds: async (_page, ads) => ads,
        },
        shared,
        applyPostFilters,
        scoreAds,
        broadcastStatus: () => {},
        sendInfo: () => {},
    });

    await handler({ send: (message) => messages.push(JSON.parse(message)) });

    const results = messages.find((message) => message.type === "results");
    const count = messages.find((message) => message.type === "ad-count");
    assert.deepEqual(
        results.data.map((ad) => ad.id),
        ["new", "near-match"],
    );
    assert.equal(count.count, 3);
    assert.equal(shared.seenAds.has("near-match"), true);
    assert.equal(shared.busy, false);
});
