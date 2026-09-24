import WebSocket from "ws";

export function setupWebSocket({
    wss,
    scraper,
    shared,
    broadcastStatus,
    sendInfo,
    handleLoadMore,
    handleStructuredSearch,
    handleSearch,
}) {
    wss.on("connection", async (ws) => {
        console.log(`New client connected! (${wss.clients.size} total)`);

        await handleConnection(ws);

        ws.on("message", (message) => {
            handleMessage(ws, message);
        });

        ws.on("close", () => {
            console.log(`Client disconnected. (${wss.clients.size} left)`);
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

            if (data.action === "load_more") {
                if (shared.busy) {
                    return sendInfo(ws, "صبر کنید...");
                }

                await handleLoadMore(ws);
                return;
            }

            if (data.action === "structured_search") {
                if (shared.busy) {
                    return sendInfo(ws, "صبر کنید...");
                }

                await handleStructuredSearch(ws, data);
                return;
            }

            if (data.text) {
                if (shared.busy) {
                    return sendInfo(ws, "صبر کنید...");
                }

                await handleSearch(ws, data.text);
            }
        } catch (error) {
            console.error("[WebSocket] Message handling error:", error.message);

            sendInfo(ws, "پیام نامعتبر است");
        }
    }
}
