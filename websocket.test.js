import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import test from "node:test";
import { setupWebSocket } from "./websocket.js";

class MockSocket extends EventEmitter {
    readyState = WebSocket.OPEN;

    send() {}
}

class MockWebSocketServer extends EventEmitter {
    clients = new Set();
}

test("buffers early messages and processes frames sequentially", async () => {
    const wss = new MockWebSocketServer();
    const ws = new MockSocket();
    wss.clients.add(ws);

    let finishBrowserSetup;
    const browserSetup = new Promise((resolve) => {
        finishBrowserSetup = resolve;
    });
    let finishFirstAuth;
    const firstAuth = new Promise((resolve) => {
        finishFirstAuth = resolve;
    });
    const actions = [];
    let secondActionStarted;
    const secondAction = new Promise((resolve) => {
        secondActionStarted = resolve;
    });

    setupWebSocket({
        wss,
        scraper: { ensureBrowser: () => browserSetup },
        shared: { busy: false },
        broadcastStatus: () => {},
        sendInfo: () => {},
        closeSession: async () => {},
        apiHandlers: {
            auth: async (_socket, data) => {
                actions.push(data.action);
                if (data.action === "request_otp") await firstAuth;
                if (data.action === "verify_otp") secondActionStarted();
            },
        },
    });

    wss.emit("connection", ws);
    ws.emit("message", Buffer.from(JSON.stringify({ action: "request_otp" })));
    ws.emit("message", Buffer.from(JSON.stringify({ action: "verify_otp" })));

    finishBrowserSetup({ page: null });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(actions, ["request_otp"]);

    finishFirstAuth();
    await secondAction;
    assert.deepEqual(actions, ["request_otp", "verify_otp"]);
});
