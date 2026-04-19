import asyncio
import sys
import json
from datetime import datetime, timezone
from playwright.async_api import async_playwright
from config import logger
from database import create_table_if_not_exists, save_to_database, create_database_connection
from utils import map_divar_to_core
from extractor import  extract_with_rules
from scraper import collect_ad_links, sync_database_ads

async def scrape_ads():
    """فرایند اصلی اسکرپ کردن آگهی‌های جدید"""
    create_table_if_not_exists()
    results = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        
        links = await collect_ad_links(page)
        # فقط پردازش ۱ لینک برای تست سریع
        target_links = links[:1]
        logger.info(f"🔄 پردازش {len(target_links)} آگهی جدید")
        
        for i, link in enumerate(target_links):
            try:
                logger.info(f"🔗 پردازش آگهی {i+1}: {link}")
                await page.goto(link, timeout=60000)
                await page.wait_for_timeout(4000)
                
                raw = await extract_with_rules(page, link)
                if not raw:
                    logger.warning(f"⚠️ استخراج داده از {link} ناموفق بود")
                    continue
                
                db_data = map_divar_to_core(
                    data=raw,
                    created_at=now,
                    updated_at=now
                )
                
                success = save_to_database(db_data)
                if success:
                    results.append(db_data)
                    logger.info(f"✅ ذخیره شد: {db_data['title'][:30]}...")
                
                await page.wait_for_timeout(3000)
            except Exception as e:
                logger.error(f"🔥 خطا در پردازش {link}: {e}")
                continue
        
        await browser.close()
    
    if results:
        with open("divar_backup.json", "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
    return results

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--sync":
        print("🔄 شروع فرایند همگام‌سازی و پاکسازی دیتابیس...")
        asyncio.run(sync_database_ads())
        print("✅ فرایند همگام‌سازی به پایان رسید.")
    else:
        print("🚀 شروع اسکرپینگ دیوار (مدل جدید)")
        ads = asyncio.run(scrape_ads())
        print(f"✅ پردازش {len(ads)} آگهی با موفقیت انجام شد")
        
        # نمایش آمار نهایی
        conn = create_database_connection()
        if conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM divar_data WHERE status NOT IN ('deleted', 'sold');")
            active_records = cursor.fetchone()[0]
            print(f"   آگهی‌های فعال در دیتابیس: {active_records}")
            cursor.close()
            conn.close()
