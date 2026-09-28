import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredSearchHandler } from "./handlers/search-handler.js";
import { scoreAds } from "./services/ad_match_scorer.js";
import { normalizeSearchInput } from "./services/search_normalizer.js";

test("sends every filtered ad ranked with a best-match marker", async () => {
    const ads = [
        { id: "over-budget", price: 9_000_000_000, area: 120, buildingAge: 2 },
        { id: "best-fit", price: 7_500_000_000, area: 118, buildingAge: 4 },
        { id: "old-small", price: 6_000_000_000, area: 95, buildingAge: 20 },
    ];
    const messages = [];
    const shared = { busy: false, seenAds: new Set() };
    const handleSearch = createStructuredSearchHandler({
        scraper: {
            navigateToSearch: async () => ({}),
            scrollToLoadAds: async () => [],
            collectAds: async () => ads,
        },
        shared,
        buildDivarRequest: () => ({
            url: "https://divar.test",
            postFilters: {},
        }),
        applyPostFilters: (results) => results,
        scoreAds,
        normalizeSearchInput,
        broadcastStatus: () => {},
        sendInfo: () => {},
        sendScreenshot: async () => {},
        startMonitoring: () => {},
    });

    await handleSearch(
        { send: (message) => messages.push(JSON.parse(message)) },
        {
            price_max: 8_000_000_000,
            size_min: 110,
            size_max: 130,
            building_age_max: 5,
        },
    );

    const resultMessage = messages.find(
        (message) => message.type === "results",
    );
    assert.ok(resultMessage);
    assert.equal(resultMessage.data.length, ads.length);
    assert.equal(resultMessage.data[0].id, "best-fit");
    assert.equal(resultMessage.data[0].isBestMatch, true);
    assert.equal(resultMessage.data.filter((ad) => ad.isBestMatch).length, 1);
    assert.ok(resultMessage.data.every((ad) => Number.isFinite(ad.matchScore)));
    assert.equal(shared.busy, false);
});
