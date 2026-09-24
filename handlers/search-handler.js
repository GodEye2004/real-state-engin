export function createStructuredSearchHandler({
    scraper,
    shared,
    buildDivarRequest,
    applyPostFilters,
    broadcastStatus,
    sendInfo,
    sendScreenshot,
    startMonitoring,
}) {
    return async function handleStructuredSearch(ws, formData) {
        shared.busy = true;
        shared.seenAds.clear();

        try {
            const search = {
                city: formData.city || "gorgan",
                category: formData.category || "buy-apartment",
                type: formData.type || null,
                rooms: formData.rooms || null,
                size_min: formData.size_min || null,
                size_max: formData.size_max || null,
                price_min: formData.price_min || null,
                price_max: formData.price_max || null,
                rent_min: formData.rent_min || null,
                rent_max: formData.rent_max || null,
                credit_min: formData.credit_min || null,
                credit_max: formData.credit_max || null,
                elevator: formData.elevator || null,
                parking: formData.parking || null,
                warehouse: formData.warehouse || null,
                query: formData.query || null,
            };

            shared.lastSearch = search;

            console.log(
                "[Pipeline] Structured search:",
                JSON.stringify(search, null, 2),
            );

            const { url, postFilters } = buildDivarRequest(search);

            shared.lastPostFilters = postFilters;

            broadcastStatus("adapt", "done", "آدرس ساخته شد");

            console.log("[Pipeline] URL:", url);

            broadcastStatus("navigate", "running", "باز کردن صفحه دیوار...");

            const page = await scraper.navigateToSearch(url);

            broadcastStatus("navigate", "done", "صفحه دیوار بارگذاری شد");

            await sendScreenshot("صفحه بارگذاری شد");

            broadcastStatus("scroll", "running", "در حال اسکرول...");

            const capturedAds = await scraper.scrollToLoadAds(page, {
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

            ads = applyPostFilters(ads, postFilters);

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
