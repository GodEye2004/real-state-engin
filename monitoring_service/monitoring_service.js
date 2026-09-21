function startMonitoring() {
    if (shared.monitor) clearInterval(shared.monitor);

    console.log("[Monitor] Started background checking every 30 seconds...");
    // broadcastStatus(
    //     "monitor",
    //     "running",
    //     "مانیتورینگ فعال — بررسی هر ۳۰ ثانیه",
    // );

    shared.monitor = setInterval(async () => {
        try {
            console.log("[Monitor] Checking for new ads...");
            // broadcastStatus("monitor", "info", "بررسی آگهیهای جدید...");

            const { page } = await scraper.ensureBrowser();
            await page.reload({ waitUntil: "domcontentloaded" });
            await page.waitForTimeout(5000);
            // await sendScreenshot("بررسی دورهای");

            let ads = await scraper.collectAds(page);
            ads = applyPostFilters(ads, shared.lastPostFilters);

            const newAds = ads.filter((ad) => {
                if (!shared.seenAds.has(ad.link)) {
                    shared.seenAds.add(ad.link);
                    return true;
                }
                return false;
            });

            if (newAds.length > 0) {
                console.log(`[Monitor] Found ${newAds.length} NEW ads!`);
                broadcastStatus(
                    "monitor",
                    "done",
                    `${newAds.length} آگهی جدید پیدا شد!`,
                );
                for (const client of wss.clients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(
                            JSON.stringify({
                                type: "notification",
                                data: newAds,
                            }),
                        );
                    }
                }
            } else {
                broadcastStatus(
                    "monitor",
                    "running",
                    "مانیتورینگ — آگهی جدیدی نیست",
                );
            }
        } catch (error) {
            console.error("[Monitor] Error:", error.message);
            broadcastStatus("monitor", "error", `خطا: ${error.message}`);
        }
    }, MONITOR_INTERVAL_MS);
}
