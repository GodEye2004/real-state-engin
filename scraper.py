from playwright.async_api import async_playwright
from config import CATEGORY_URL, logger
from database import create_database_connection, update_ad_status
from psycopg2.extras import RealDictCursor

async def collect_ad_links(page):
    await page.goto(CATEGORY_URL, timeout=60000)
    last_height = 0
    for _ in range(10):
        await page.mouse.wheel(0, 3000)
        await page.wait_for_timeout(2000)
        h = await page.evaluate("document.body.scrollHeight")
        if h == last_height:
            break
        last_height = h
        await page.wait_for_timeout(1000)
    
    await page.wait_for_timeout(3000)
    links = await page.eval_on_selector_all(
        "a[href^='/v/']",
        "els => els.map(e => e.getAttribute('href'))"
    )
    unique_links = list(set(links))
    logger.info(f"✅ {len(unique_links)} آگهی یافت شد")
    return [f"https://divar.ir{l}" for l in unique_links]

async def check_ad_status(page, url: str) -> str:
    try:
        await page.goto(url, timeout=60000)
        await page.wait_for_timeout(3000)
        page_content = await page.content()
        
        if "این آگهی از دیوار حذف شده است" in page_content or "آگهی حذف شده" in page_content:
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

async def sync_database_ads():
    conn = create_database_connection()
    if not conn:
        return
    
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT source_link FROM divar_data WHERE status IN ('pending', 'approved', 'active')")
        ads = cursor.fetchall()
        cursor.close()
        conn.close()
        
        if not ads:
            logger.info("✅ هیچ آگهی فعالی برای بازبینی یافت نشد.")
            return

        logger.info(f"🔄 بازبینی وضعیت {len(ads)} آگهی موجود در دیتابیس...")
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            for ad in ads:
                link = ad['source_link']
                logger.info(f"🔎 چک کردن: {link}")
                status = await check_ad_status(page, link)
                logger.info(f"📍 وضعیت یافت شده: {status}")
                
                if status in ['deleted', 'expired', 'sold']:
                    mapped_status = 'sold' if status == 'sold' else 'deleted'
                    if update_ad_status(link, mapped_status):
                        logger.info(f"✅ وضعیت آگهی در دیتابیس به '{mapped_status}' تغییر یافت.")
                await page.wait_for_timeout(2000)
            await browser.close()
    except Exception as e:
        logger.error(f"Error during sync: {e}")
