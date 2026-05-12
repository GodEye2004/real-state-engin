import asyncio
import sys
import json
import random
from datetime import datetime, timezone
from playwright.async_api import async_playwright
from core.config import logger
from utiles.utils import map_divar_to_core
from engin.extractor import extract_with_rules
from engin.scraper import collect_ad_links

from core.config import save_to_db


def process_item(item):
    success = save_to_db(item)

    if success:
        print("Saved:", item["external_id"])
    else:
        print("Failed:", item["external_id"])


async def scrape_ads(should_stop=None):
    """فرایند اصلی اسکرپ کردن آگهی‌های جدید"""
    results = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        links = await collect_ad_links(page)
        logger.info(f"پردازش {len(links)} آگهی جدید")

        for i, link in enumerate(links):
            # بررسی توقف زودهنگام (مثلاً تمام شدن زمان تسک)
            if should_stop and should_stop():
                logger.info(" توقف به دلیل اتمام زمان درخواست شد.")
                break

            try:
                logger.info(f"🔗 پردازش آگهی {i+1}: {link}")
                await page.goto(link, timeout=60000)
                await page.wait_for_timeout(4000)

                raw = await extract_with_rules(page, link)
                if not raw:
                    logger.warning(f"استخراج داده از {link} ناموفق بود")
                    continue

                db_data = map_divar_to_core(data=raw, created_at=now, updated_at=now)

                if process_item(db_data):
                    results.append(db_data)
                    logger.info(f"ذخیره شد: {db_data['title'][:30]}...")

                # وقفه تصادفی بین آگهی‌ها (۲ تا ۵ ثانیه) برای جلوگیری از مسدود شدن
                await asyncio.sleep(random.uniform(2, 5))
            except Exception as e:
                logger.error(f" خطا در پردازش {link}: {e}")
                continue

        await browser.close()

    return results


if __name__ == "__main__":
    print("شروع اسکرپینگ دیوار (مدل جدید)")
    ads = asyncio.run(scrape_ads())
    print(f"پردازش {len(ads)} آگهی با موفقیت انجام شد")
