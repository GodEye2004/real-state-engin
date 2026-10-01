import assert from "node:assert/strict";
import test from "node:test";
import { MATCH_CONFIG, scoreAds } from "./ad_match_scorer.js";

const listings = [
    {
        id: "over-budget",
        price: 9_000_000_000,
        area: 120,
        buildingAge: 2,
        district: "Gorgan, Golshahr",
    },
    {
        id: "best-fit",
        price: 7_500_000_000,
        area: 118,
        buildingAge: 4,
        district: "Golshahr",
    },
    {
        id: "low-budget-old",
        price: 6_000_000_000,
        area: 95,
        buildingAge: 20,
        district: "Gorgan, Nahar Khoran",
    },
];

test("scores every listing and sorts the strongest match first", () => {
    const results = scoreAds(listings, {
        price_max: 8_000_000_000,
        size_min: 110,
        size_max: 130,
        building_age_max: 5,
        district: "Golshahr",
    });

    assert.equal(results.length, listings.length);
    assert.equal(results[0].id, "best-fit");
    assert.equal(results[0].matchScore, 100);
    assert.deepEqual(results[0].matchBreakdown, {
        budget: 100,
        area: 100,
        buildingAge: 100,
        location: 100,
    });
    assert.equal(results[0].isBestMatch, true);
    assert.equal(results.filter((ad) => ad.isBestMatch).length, 1);
    assert.ok(results[1].matchScore > results[2].matchScore);
});

test("uses each user's criteria weights to change the ranking", () => {
    const preferenceSensitiveListings = [
        { id: "within-budget-old", price: 7_500_000_000, buildingAge: 20 },
        { id: "over-budget-new", price: 9_000_000_000, buildingAge: 2 },
    ];
    const budgetFirst = scoreAds(
        preferenceSensitiveListings,
        {
            price_max: 8_000_000_000,
            building_age_max: 5,
        },
        { weights: { budget: 0.9, buildingAge: 0.1 } },
    );
    const ageFirst = scoreAds(
        preferenceSensitiveListings,
        { price_max: 8_000_000_000, building_age_max: 5 },
        { weights: { budget: 0.1, buildingAge: 0.9 } },
    );

    assert.equal(budgetFirst[0].id, "within-budget-old");
    assert.equal(ageFirst[0].id, "over-budget-new");
});

test("keeps listings without matching data and reports it as unknown", () => {
    const results = scoreAds(
        [{ id: "unknown" }, { id: "known", price: 8_000_000_000 }],
        { price_max: 8_000_000_000 },
    );

    assert.equal(results.length, 2);
    assert.deepEqual(results.find((ad) => ad.id === "unknown").matchBreakdown, {
        budget: null,
    });
    assert.equal(results.find((ad) => ad.id === "unknown").matchScore, 50);
});

test("does not reorder or mark results when no preferences are provided", () => {
    const results = scoreAds(listings);

    assert.deepEqual(
        results.map((ad) => ad.id),
        listings.map((ad) => ad.id),
    );
    assert.ok(results.every((ad) => ad.matchScore === null));
    assert.ok(results.every((ad) => !ad.isBestMatch));
});

test("returns no results without error when preferences match no listings", () => {
    assert.deepEqual(scoreAds([], { price_max: 8_000_000_000 }), []);
});

test("exposes the base weights for inspection and customization", () => {
    assert.deepEqual(MATCH_CONFIG.weights, {
        budget: 0.45,
        buildingAge: 0.3,
        area: 0.25,
        location: 0.2,
    });
});
