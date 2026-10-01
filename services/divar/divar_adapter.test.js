import assert from "node:assert/strict";
import test from "node:test";
import { applyPostFilters } from "./divar_adapter.js";

test("keeps near-budget ads but drops extreme over-budget listings", () => {
    const ads = [
        { id: "near-budget", price: 9_500_000_000, area: 130, rooms: 3 },
        { id: "within-range", price: 7_000_000_000, area: 120, rooms: 3 },
        { id: "extreme-budget", price: 42_000_000_000, area: 130, rooms: 3 },
        { id: "unknown-price", area: 120, rooms: 3 },
        { id: "wrong-rooms", price: 7_000_000_000, area: 120, rooms: 2 },
    ];

    const results = applyPostFilters(
        ads,
        { price_max: 8_000_000_000, size_min: 110, rooms: "3" },
        { scoreBoundsOnly: true },
    );

    assert.deepEqual(
        results.map((ad) => ad.id),
        ["near-budget", "within-range", "unknown-price"],
    );
});

test("excludes prices above the configurable budget-overrun allowance", () => {
    const ads = [
        { id: "within-allowance", price: 13_500_000_000 },
        { id: "outside-allowance", price: 42_000_000_000 },
    ];

    const results = applyPostFilters(
        ads,
        { price_max: 11_000_000_000 },
        { scoreBoundsOnly: true },
    );

    assert.deepEqual(
        results.map((ad) => ad.id),
        ["within-allowance"],
    );
});
