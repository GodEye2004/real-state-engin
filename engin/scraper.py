from playwright.async_api import async_playwright
from core.config import CATEGORY_URL, logger


async def collect_ad_links(page):
    # تنظیم ابعاد صفحه برای پایداری
    await page.set_viewport_size({"width": 1280, "height": 800})
    await page.goto(CATEGORY_URL, timeout=90000)

    # صبر اولیه برای پایداری
    await page.wait_for_timeout(8000)

    last_count = 0
    consecutive_no_growth = 0

    logger.info("🎬 شروع اسکرول مرحله‌ای برای بارگذاری آگهی‌های بیشتر...")

    for i in range(40):
        # اسکرول مرحله‌ای برای شبیه‌سازی رفتار واقعی و تحریک API دیوار
        for step in range(10):
            await page.evaluate("window.scrollBy(0, 400)")
            await page.wait_for_timeout(300)

        # صبر برای فراخوانی API و رندر شدن آیتم‌ها
        await page.wait_for_timeout(4000)

        # فشار دادن End برای اطمینان از رسیدن به ته صفحه
        await page.keyboard.press("End")
        await page.wait_for_timeout(2000)

        # استخراج لینک‌ها
        links = await page.query_selector_all("a[href^='/v/']")
        count = len(links)
        logger.info(f"ads loaded{i+1}: {count} .")

        if count > last_count:
            consecutive_no_growth = 0
        else:
            consecutive_no_growth += 1

        if consecutive_no_growth >= 3:
            logger.info("stop we dint see anything")
            break

        last_count = count

    final_links = await page.eval_on_selector_all(
        "a[href^='/v/']", "els => els.map(e => e.getAttribute('href'))"
    )
    unique_links = list(set(final_links))
    logger.info(f"specefic ads found {len(unique_links)} ")
    return [f"https://divar.ir{l}" for l in unique_links]


async def check_ad_status(page, url: str) -> str:
    try:
        await page.goto(url, timeout=60000)
        await page.wait_for_timeout(3000)
        page_content = await page.content()

        if (
            "این آگهی از دیوار حذف شده است" in page_content
            or "آگهی حذف شده" in page_content
        ):
            return "deleted"

        if "این آگهی منقضی شده است" in page_content:
            return "expired"

        contact_btn = await page.query_selector("button:has-text('اطلاعات تماس')")
        if not contact_btn:
            if "فروخته شده" in page_content:
                return "sold"
            h1 = await page.query_selector("h1")
            if not h1:
                return "deleted"

        return "active"
    except Exception as e:
        logger.error(f"Error checking status for {url}: {e}")
        return "error"
