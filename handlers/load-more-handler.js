export function createLoadMoreHandler({
    scraper,
    shared,
    buildDivarRequest,
    applyPostFilters,
    scoreAds,
    broadcastStatus,
    sendInfo,
    getUserState,
    saveSearchResults,
}) {
    return async function handleLoadMore(ws) {
        shared.busy = true;
        const reportStatus = (step, status, message, progress = null) =>
            broadcastStatus(step, status, message, progress, ws);

        try {
            const userState = getUserState(ws);
            if (!ws.userId || !userState.searchId) {
                sendInfo(ws, "Start a search before requesting more ads");
                return;
            }

            const { url } = buildDivarRequest(userState.search);
            const page = await scraper.navigateToSearch(url);

            const capturedAds = await scraper.scrollToLoadAds(page, {
                maxRounds: 10,
                staleThreshold: 3,

                onProgress: ({ round, maxRounds, adsCollected }) => {
                    const progress = Math.round((round / maxRounds) * 100);

                    reportStatus(
                        "scroll",
                        "running",
                        `${adsCollected || 0} آگهی جمع‌آوری شد`,
                        progress,
                    );
                },
            });
            // apply post-filters to the ads and score them based on the last search criteria
            const filteredAds = applyPostFilters(
                await scraper.collectAds(page, capturedAds),
                userState.postFilters,
                { scoreBoundsOnly: true },
            );
            const newAds = filteredAds.filter(
                (ad) => !userState.seenAds.has(ad.link),
            );
            const ads = scoreAds(newAds, userState.search || {}, {
                weights: userState.search?.match_weights || undefined,
            });

            await saveSearchResults({
                searchId: userState.searchId,
                userId: ws.userId,
                ads,
            });

            ads.forEach((ad) => {
                userState.seenAds.add(ad.link);
            });

            userState.adCount += ads.length;

            reportStatus("collect", "done", `${ads.length} آگهی جدید یافت شد`);

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
                    count: userState.adCount,
                }),
            );
        } catch (error) {
            console.error("[Pipeline] Load more error:", error.message);

            sendInfo(ws, `خطا: ${error.message}`);

            reportStatus("error", "error", `خطا: ${error.message}`);
        } finally {
            shared.busy = false;
        }
    };
}
