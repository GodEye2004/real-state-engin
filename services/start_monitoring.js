import WebSocket from "ws";

export function createMonitor({
    shared,
    scraper,
    wss,
    broadcastStatus,
    buildDivarRequest,
    applyPostFilters,
    monitorIntervalMs,
}) {
    let monitor = null;

    function startMonitoring() {
        if (monitor) {
            clearInterval(monitor);
        }

        console.log(
            `[Monitor] Started. Checking Divar every ${monitorIntervalMs / 1000} seconds...`,
        );

        broadcastStatus("monitor", "running", "جستجوی دائمی فعال است");

        monitor = setInterval(async () => {
            if (shared.busy || !shared.lastSearch) {
                return;
            }

            try {
                const { url } = buildDivarRequest(shared.lastSearch);

                const page = await scraper.navigateToSearch(url);

                const ads = applyPostFilters(
                    await scraper.collectAds(page),
                    shared.lastPostFilters,
                );

                const newAds = ads.filter((ad) => {
                    if (shared.seenAds.has(ad.link)) {
                        return false;
                    }

                    shared.seenAds.add(ad.link);

                    return true;
                });

                console.log(
                    `[Monitor] Checked ${ads.length} ads, ${newAds.length} new ads found.`,
                );

                broadcastStatus(
                    "monitor",
                    "running",
                    newAds.length
                        ? `${newAds.length} آگهی جدید پیدا شد`
                        : "جستجوی دائمی فعال است؛ آگهی جدیدی پیدا نشد",
                );

                if (newAds.length > 0) {
                    const payload = JSON.stringify({
                        type: "notification",
                        data: newAds,
                    });

                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(payload);
                        }
                    });
                }
            } catch (error) {
                console.error("[Monitor] Error:", error.message);

                broadcastStatus(
                    "monitor",
                    "error",
                    `خطا در جستجوی دائمی: ${error.message}`,
                );
            }
        }, monitorIntervalMs);
    }

    function stopMonitoring() {
        if (monitor) {
            clearInterval(monitor);
            monitor = null;

            console.log("[Monitor] Stopped.");
        }
    }

    return {
        startMonitoring,
        stopMonitoring,
    };
}
