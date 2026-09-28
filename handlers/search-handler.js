export function createStructuredSearchHandler({
    scraper,
    shared,
    buildDivarRequest,
    applyPostFilters,
    scoreAds,
    normalizeSearchInput,
    broadcastStatus,
    sendInfo,
    sendScreenshot,
    startMonitoring,
}) {
    return async function handleStructuredSearch(ws, formData) {
        shared.busy = true;
        shared.seenAds.clear();

        try {
            const search = normalizeSearchInput(formData || {});

            shared.lastSearch = search;

            console.log(
                "[Pipeline] Structured search:",
                JSON.stringify(search, null, 2),
            );

            const { url, postFilters } = buildDivarRequest(search);

            shared.lastPostFilters = postFilters;

            ws.send(
                JSON.stringify({
                    type: "applied-filters",
                    data: search,
                    postFilters,
                }),
            );

            broadcastStatus("adapt", "done", "آدرس ساخته شد");

            console.log("[Pipeline] URL:", url);

            broadcastStatus("navigate", "running", "باز کردن صفحه دیوار...");

            const page = await scraper.navigateToSearch(url);

            broadcastStatus("navigate", "done", "صفحه دیوار بارگذاری شد");

            await sendScreenshot("صفحه بارگذاری شد");

            broadcastStatus("scroll", "running", "در حال اسکرول...");

            const capturedAds = await scraper.scrollToLoadAds(page, {
                maxRounds: 10,
                staleThreshold: 3,
                onProgress: ({ round, maxRounds, cardsVisible }) => {
                    const progress = Math.round((round / maxRounds) * 100);

                    broadcastStatus(
                        "scroll",
                        "running",
                        `${cardsVisible} کارت قابل مشاهده`,
                        progress,
                    );
                },
            });

            await sendScreenshot("نتایج بارگذاری شد");

            broadcastStatus("collect", "running", "جمع‌آوری آگهیها...");

            let ads = await scraper.collectAds(page, capturedAds);

            console.log(`[Pipeline] Before post-filter: ${ads.length} ads`);

            ads = applyPostFilters(ads, postFilters, {
                scoreBoundsOnly: true,
            });

            ads = scoreAds(ads, search, {
                weights: search.match_weights || undefined,
            });

            console.log(`[Pipeline] After post-filter: ${ads.length} ads`);

            shared.adCount = ads.length;

            ads.forEach((ad) => {
                shared.seenAds.add(ad.link);
            });

            broadcastStatus("collect", "done", `${ads.length} آگهی یافت شد`);

            ws.send(
                JSON.stringify({
                    type: "results",
                    data: ads,
                    isNewSearch: true,
                }),
            );

            ws.send(
                JSON.stringify({
                    type: "ad-count",
                    count: ads.length,
                }),
            );

            startMonitoring();
        } catch (error) {
            console.error("[Pipeline] Error:", error.message);

            sendInfo(ws, `خطا: ${error.message}`);

            broadcastStatus("error", "error", `خطا: ${error.message}`);
        } finally {
            shared.busy = false;
        }
    };
}
