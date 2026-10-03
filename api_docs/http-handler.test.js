import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { handleHttpRequest } from "./http-handler.js";

test("redirects the root page to docs and serves the API explorer", async (t) => {
    const server = createServer(handleHttpRequest);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());

    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;

    const root = await fetch(origin);
    assert.equal(root.status, 200);
    assert.equal(root.url, `${origin}/docs`);

    const docs = await fetch(`${origin}/docs`);
    assert.equal(docs.status, 200);
    assert.match(docs.headers.get("content-type"), /text\/html/);
    assert.match(await docs.text(), /Live API explorer/);
});

test("returns JSON 404 for unsupported HTTP routes", async (t) => {
    const server = createServer(handleHttpRequest);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());

    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/unknown`);

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Not found" });
});

test("publishes the same registered actions consumed by WebSocket dispatch", async (t) => {
    const server = createServer(handleHttpRequest);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());

    const address = server.address();
    const response = await fetch(
        `http://127.0.0.1:${address.port}/api-docs.json`,
    );
    const registry = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(
        registry.operations.map((operation) => operation.action),
        [
            "request_otp",
            "verify_otp",
            "resume_session",
            "structured_search",
            "text_search",
            "load_more",
        ],
    );
    assert.ok(
        registry.responseEvents.some((event) => event.type === "results"),
    );
});
