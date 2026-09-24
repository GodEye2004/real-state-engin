import WebSocket from "ws";

export async function sendScreenshot(scraper, wss, label) {
    try {
        const { page } = await scraper.ensureBrowser();
        if (!page || page.isClosed()) return;

        const image = await page.screenshot({
            type: "jpeg",
            quality: 60,
            animations: "disabled",
            timeout: 10000,
        });

        const payload = JSON.stringify({
            type: "screenshot",
            image: image.toString("base64"),
            url: page.url(),
            label,
        });

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
    } catch (error) {
        console.warn(`[Screenshot] Skipped: ${error.message}`);
    }
}
