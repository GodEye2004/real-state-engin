import WebSocket from "ws";

export function createMonitor({
    shared,
    scraper,
    wss,
    broadcastStatus,
    buildDivarRequest,
    applyPostFilters,
    scoreAds,
    saveSearchResults,
    monitorIntervalMs,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
}) {
    let monitor = null;
    let checking = false;

    function startMonitoring() {
        if (monitor) {
            clearIntervalFn(monitor);
        }

        console.log(
            `[Monitor] Started. Checking Divar every ${monitorIntervalMs / 1000} seconds...`,
        );

        broadcastStatus("monitor", "running", "جستجوی دائمی فعال است");

        monitor = setIntervalFn(async () => {
            if (shared.busy || checking || shared.activeSearches.size === 0) {
                return;
            }

            checking = true;
            try {
                for (const searchState of shared.activeSearches.values()) {
                    if (shared.busy) break;
                    if (!searchState.searchId || !searchState.userId) continue;

                    shared.busy = true;
                    try {
                        const { url } = buildDivarRequest(searchState.search);
                        const page = await scraper.navigateToSearch(url);

                        const filteredAds = applyPostFilters(
                            await scraper.collectAds(page),
                            searchState.postFilters,
                            { scoreBoundsOnly: true },
                        );
                        const ads = scoreAds(filteredAds, searchState.search, {
                            weights:
                                searchState.search.match_weights || undefined,
                        });

                        const newAds = ads.filter((ad) => {
                            if (searchState.seenAds.has(ad.link)) {
                                return false;
                            }

                            return true;
                        });

                        if (newAds.length > 0) {
                            await saveSearchResults({
                                searchId: searchState.searchId,
                                userId: searchState.userId,
                                ads: newAds,
                            });
                            newAds.forEach((ad) =>
                                searchState.seenAds.add(ad.link),
                            );
                            searchState.adCount += newAds.length;
                        }

                        console.log(
                            `[Monitor] User ${searchState.userId}: checked ${ads.length} ads, ${newAds.length} new ads found.`,
                        );

                        const ownerSocket = [...wss.clients].find(
                            (client) =>
                                client.readyState === WebSocket.OPEN &&
                                client.sessionId === searchState.sessionId,
                        );
                        if (ownerSocket) {
                            broadcastStatus(
                                "monitor",
                                "running",
                                newAds.length
                                    ? `${newAds.length} آگهی جدید پیدا شد`
                                    : "جستجوی دائمی فعال است؛ آگهی جدیدی پیدا نشد",
                                null,
                                ownerSocket,
                            );
                        }

                        if (newAds.length > 0) {
                            const payload = JSON.stringify({
                                type: "notification",
                                data: newAds,
                            });

                            wss.clients.forEach((client) => {
                                if (
                                    client.readyState === WebSocket.OPEN &&
                                    client.sessionId === searchState.sessionId
                                ) {
                                    client.send(payload);
                                }
                            });
                        }
                    } finally {
                        shared.busy = false;
                    }
                }
            } catch (error) {
                console.error("[Monitor] Error:", error.message);

                broadcastStatus(
                    "monitor",
                    "error",
                    `خطا در جستجوی دائمی: ${error.message}`,
                );
            } finally {
                shared.busy = false;
                checking = false;
            }
        }, monitorIntervalMs);
    }

    function stopMonitoring() {
        if (monitor) {
            clearIntervalFn(monitor);
            monitor = null;

            console.log("[Monitor] Stopped.");
        }
    }

    return {
        startMonitoring,
        stopMonitoring,
    };
}
