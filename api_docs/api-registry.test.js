import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiOperation } from "./api-registry.js";

test("resolves registered action names to their configured handlers", () => {
    assert.equal(
        resolveApiOperation({ action: "request_otp" }).handlerKey,
        "auth",
    );
    assert.equal(
        resolveApiOperation({ action: "structured_search" }).handlerKey,
        "structuredSearch",
    );
    assert.equal(resolveApiOperation({ action: "unknown" }), null);
});

test("keeps the legacy text-only search message mapped to free-text search", () => {
    assert.equal(
        resolveApiOperation({ text: "apartment in Gorgan" }).action,
        "text_search",
    );
});
