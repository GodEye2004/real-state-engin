export function createLoadMoreHandler({
    scraper,
    shared,
    applyPostFilters,
    broadcastStatus,
    sendInfo,
}) {
    return async function handleLoadMore(ws) {
        shared.busy = true;

        try {
            const { page } = await scraper.ensureBrowser();

            const capturedAds = await scraper.scrollToLoadAds(page, {
                maxRounds: 10,
                staleThreshold: 3,

                onProgress: ({ round, maxRounds, adsCollected }) => {
                    const progress = Math.round((round / maxRounds) * 100);

                    broadcastStatus(
                        "scroll",
                        "running",
                        `${adsCollected || 0} آگهی جمع‌آوری شد`,
                        progress,
                    );
                },
            });

            const ads = applyPostFilters(
                await scraper.collectAds(page, capturedAds),
                shared.lastPostFilters,
            );

            ads.forEach((ad) => {
                shared.seenAds.add(ad.link);
            });

            shared.adCount = ads.length;

            broadcastStatus("collect", "done", `${ads.length} آگهی یافت شد`);

            ws.send(
                JSON.stringify({
                    type: "results",
                    data: ads,
                    isNewSearch: false,
                }),
            );

            ws.send(
                JSON.stringify({
                    type: "ad-count",
                    count: ads.length,
                }),
            );
        } catch (error) {
            console.error("[Pipeline] Load more error:", error.message);

            sendInfo(ws, `خطا: ${error.message}`);

            broadcastStatus("error", "error", `خطا: ${error.message}`);
        } finally {
            shared.busy = false;
        }
    };
}
