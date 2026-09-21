// Search with user prompt.

// async function handleSearch(ws, userPrompt) {
//   shared.busy = true;
//   shared.seenAds.clear();

//   try {
//     // Step 1: Parse user prompt
//     broadcastStatus("parse", "running", "تحلیل درخواست...");
//     sendInfo(ws, "در حال تحلیل درخواست شما...");
//     const search = await parseSearchPrompt(userPrompt);
//     shared.lastSearch = search;
//     broadcastStatus("parse", "done", "درخواست تحلیل شد");
//     console.log("[Pipeline] Parsed:", JSON.stringify(search, null, 2));

//     // Step 2: Build Divar URL
//     const { url, postFilters } = buildDivarRequest(search);
//     shared.lastPostFilters = postFilters;
//     broadcastStatus("adapt", "done", "آدرس ساخته شد");
//     console.log("[Pipeline] URL:", url);
//     console.log("[Pipeline] Post-filters:", JSON.stringify(postFilters));

//     // Step 3: Navigate
//     broadcastStatus("navigate", "running", "باز کردن صفحه دیوار...");
//     const page = await scraper.navigateToSearch(url);
//     broadcastStatus("navigate", "done", "صفحه دیوار بارگذاری شد");
//     await sendScreenshot("صفحه بارگذاری شد");

//     // Step 4: Scroll
//     broadcastStatus("scroll", "running", "در حال اسکرول...");
//     await scraper.scrollToLoadAds(page, {
//       onProgress: ({ round, maxRounds, cardsVisible }) => {
//         const progress = Math.round((round / maxRounds) * 100);
//         broadcastStatus(
//           "scroll",
//           "running",
//           `${cardsVisible} کارت قابل مشاهده`,
//           progress,
//         );
//       },
//     });

//     // Step 5: Collect + normalize + dedupe
//     broadcastStatus("collect", "running", "جمع‌آوری آگهیها...");
//     let ads = await scraper.collectAds(page);
//     console.log(`[Pipeline] Before post-filter: ${ads.length} ads`);

//     // Step 6: Post-filter for extra precision
//     ads = applyPostFilters(ads, postFilters);
//     console.log(`[Pipeline] After post-filter: ${ads.length} ads`);

//     shared.adCount = ads.length;
//     broadcastStatus("collect", "done", `${ads.length} آگهی دقیق یافت شد`);
//     ws.send(JSON.stringify({ type: "results", data: ads, isNewSearch: true }));
//     ws.send(JSON.stringify({ type: "ad-count", count: ads.length }));

//     startMonitoring();
//   } catch (error) {
//     console.error("[Pipeline] Error:", error.message);
//     sendInfo(ws, `خطا: ${error.message}`);
//     broadcastStatus("error", "error", `خطا: ${error.message}`);
//   } finally {
//     shared.busy = false;
//   }
// }

// this is for handle more data from user text's

// async function handleLoadMore(ws) {
//   const { page } = await scraper.ensureBrowser();
//   if (!page) return sendInfo(ws, "اول یک جستجو انجام بدهید.");

//   shared.busy = true;
//   try {
//     sendInfo(ws, "در حال اسکرول و دریافت آگهیهای بیشتر...");
//     broadcastStatus("scroll", "running", "در حال اسکرول...");

//     await scraper.scrollToLoadAds(page, {
//       onProgress: ({ round, maxRounds, cardsVisible }) => {
//         const progress = Math.round((round / maxRounds) * 100);
//         broadcastStatus(
//           "scroll",
//           "running",
//           `${cardsVisible} کارت قابل مشاهده`,
//           progress,
//         );
//       },
//     });

//     let ads = await scraper.collectAds(page);
//     ads = applyPostFilters(ads, shared.lastPostFilters);

//     const newAds = ads.filter((ad) => {
//       if (!shared.seenAds.has(ad.link)) {
//         shared.seenAds.add(ad.link);
//         return true;
//       }
//       return false;
//     });

//     if (newAds.length > 0) {
//       broadcastStatus("scroll", "done", `${newAds.length} آگهی جدید پیدا شد`);
//       ws.send(JSON.stringify({ type: "results", data: newAds }));
//     } else {
//       broadcastStatus("scroll", "done", "آگهی جدیدی پیدا نشد");
//       sendInfo(ws, "فعلا آگهی جدیدی یافت نشد.");
//     }
//   } finally {
//     shared.busy = false;
//   }
// }
