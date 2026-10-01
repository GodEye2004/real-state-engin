import WebSocket from "ws";
import { resolveApiOperation } from "./api_docs/api-registry.js";

export function setupWebSocket({
    wss,
    scraper,
    shared,
    broadcastStatus,
    sendInfo,
    apiHandlers,
    closeSession,
}) {
    wss.on("connection", (ws) => {
        console.log(`New client connected! (${wss.clients.size} total)`);

        let messageQueue = handleConnection(ws);

        ws.on("message", (message) => {
            messageQueue = messageQueue.then(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    return handleMessage(ws, message);
                }
            });
        });

        ws.on("close", () => {
            console.log(`Client disconnected. (${wss.clients.size} left)`);
            if (ws.sessionId && ws.userId) {
                closeSession({
                    sessionId: ws.sessionId,
                    userId: ws.userId,
                }).catch((error) => {
                    console.error("[Session] Close failed:", error.message);
                });
            }
        });
    });

    async function handleConnection(ws) {
        try {
            const { page } = await scraper.ensureBrowser();

            if (page && !page.isClosed()) {
                broadcastStatus("browser", "done", "مرورگر در حال کار است");
            } else {
                broadcastStatus(
                    "browser",
                    "info",
                    "در انتظار اولین درخواست جستجو...",
                );
            }
        } catch {
            broadcastStatus(
                "browser",
                "info",
                "در انتظار اولین درخواست جستجو...",
            );
        }
    }

    async function handleMessage(ws, message) {
        try {
            const data = JSON.parse(message.toString());

            const operation = resolveApiOperation(data);
            if (!operation) return;

            if (operation.requiresIdle && shared.busy) {
                return sendInfo(ws, "صبر کنید...");
            }

            const handler = apiHandlers[operation.handlerKey];
            if (!handler) {
                return sendInfo(
                    ws,
                    `Action ${operation.action} is not configured`,
                );
            }

            await handler(ws, data);
        } catch (error) {
            console.error("[WebSocket] Message handling error:", error.message);

            sendInfo(ws, "پیام نامعتبر است");
        }
    }
}
