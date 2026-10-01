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
    getUserState,
    createSearch,
    saveSearchResults,
}) {
    return async function handleStructuredSearch(ws, formData) {
        shared.busy = true;
        const reportStatus = (step, status, message, progress = null) =>
            broadcastStatus(step, status, message, progress, ws);

        try {
            if (!ws.userId || !ws.sessionId) {
                sendInfo(ws, "Verify your phone before starting a search");
                return;
            }

            const userState = getUserState(ws);
            userState.seenAds.clear();

            // we canvert massive datat come from client to the divar clean data structure base.
            const search = normalizeSearchInput(formData || {});

            console.log(
                "[Pipeline] Structured search:",
                JSON.stringify(search, null, 2),
            );
            // after that we creat a divar req with clean data
            const { url, postFilters } = buildDivarRequest(search);

            const searchRecord = await createSearch({
                userId: ws.userId,
                sessionId: ws.sessionId,
                query:
                    search.query ||
                    [search.type, search.city].filter(Boolean).join(" ") ||
                    "Property search",
                filters: search,
            });
            userState.userId = ws.userId;
            userState.sessionId = ws.sessionId;
            userState.searchId = searchRecord.id;
            userState.search = search;
            userState.postFilters = postFilters;
            userState.adCount = 0;
            shared.activeSearches.set(ws.sessionId, userState);

            // the server send the search and postFilters to the client for display
            ws.send(
                JSON.stringify({
                    type: "applied-filters",
                    data: search,
                    postFilters,
                }),
            );

            reportStatus("adapt", "done", "آدرس ساخته شد");

            console.log("[Pipeline] URL:", url);

            reportStatus("navigate", "running", "باز کردن صفحه دیوار...");
            // we open divar page with data recive from client and wait for load page .
            const page = await scraper.navigateToSearch(url);

            reportStatus("navigate", "done", "صفحه دیوار بارگذاری شد");

            await sendScreenshot("صفحه بارگذاری شد", ws); // we capture the screenshot of the page and send it to the client for display

            reportStatus("scroll", "running", "در حال اسکرول...");
            //Scroll and load advertisements
            const capturedAds = await scraper.scrollToLoadAds(page, {
                // the scraper repeatedly scrolls divar page and report progress.
                maxRounds: 10,
                staleThreshold: 3,
                onProgress: ({ round, maxRounds, cardsVisible }) => {
                    const progress = Math.round((round / maxRounds) * 100);

                    reportStatus(
                        "scroll",
                        "running",
                        `${cardsVisible} کارت قابل مشاهده`,
                        progress,
                    );
                },
            });

            await sendScreenshot("نتایج بارگذاری شد", ws);

            reportStatus("collect", "running", "جمع‌آوری آگهیها...");

            let ads = await scraper.collectAds(page, capturedAds);

            console.log(`[Pipeline] Before post-filter: ${ads.length} ads`);
            // apply post-filters to the ads and score them based on the search criteria
            ads = applyPostFilters(ads, postFilters, {
                // this remove clearly unsuitable results based on the post-filters provided by the user.
                scoreBoundsOnly: true,
            });
            // each advertisement recives , matchScore , matchBreakdown , isBestMatch.
            ads = scoreAds(ads, search, {
                weights: search.match_weights || undefined,
            });

            console.log(`[Pipeline] After post-filter: ${ads.length} ads`);

            await saveSearchResults({
                searchId: userState.searchId,
                userId: ws.userId,
                ads,
            });

            userState.adCount = ads.length;

            ads.forEach((ad) => {
                userState.seenAds.add(ad.link);
            });

            reportStatus("collect", "done", `${ads.length} آگهی یافت شد`);
            // after all progress we send result here for client.
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
                    count: userState.adCount,
                }),
            );

            startMonitoring(); // in here , system start monitore divar for find new ads matche to client want
        } catch (error) {
            console.error("[Pipeline] Error:", error.message);

            sendInfo(ws, `خطا: ${error.message}`);

            reportStatus("error", "error", `خطا: ${error.message}`);
        } finally {
            shared.busy = false;
        }
    };
}
