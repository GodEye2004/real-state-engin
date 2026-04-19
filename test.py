import asyncio
import random
import time
from playwright.async_api import async_playwright
import logging
import json
import base64
from azure.ai.inference import ChatCompletionsClient
from azure.ai.inference.models import SystemMessage, UserMessage
from azure.core.credentials import AzureKeyCredential

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

CATEGORY_URL = "https://divar.ir/s/gorgan/buy-apartment"

GITHUB_TOKEN = "***REMOVED***"

endpoint = "https://models.inference.ai.azure.com"
model_name = "gpt-4o"

client = ChatCompletionsClient(
    endpoint=endpoint,
    credential=AzureKeyCredential(GITHUB_TOKEN),
)


async def human_like_scroll(page, scroll_distance=300, variance=100):
    """
    اسکرول طبیعی مانند انسان با تغییرات تصادفی
    """
    # تغییر تصادفی در فاصله اسکرول
    actual_distance = scroll_distance + random.randint(-variance, variance)

    # سرعت متفاوت برای اسکرول - با steps طبیعی‌تر
    steps = random.randint(3, 10)  # تعداد مراحل اسکرول
    step_distance = actual_distance / steps

    for step in range(steps):
        # اسکرول تدریجی
        await page.mouse.wheel(0, step_distance)

        # تاخیر تصادفی بین مراحل اسکرول
        step_delay = random.uniform(0.05, 0.2)
        await page.wait_for_timeout(step_delay * 1000)

    # تاخیر اصلی بعد از اسکرول
    delay = random.uniform(0.5, 2.5)
    await page.wait_for_timeout(delay * 1000)

    # گاهی اوقات حرکت موس کوچک برای طبیعی‌تر شدن
    if random.random() > 0.7:  # 30% مواقع
        # حرکت موس به یک موقعیت تصادفی در صفحه
        viewport = page.viewport_size
        x = random.randint(100, viewport["width"] - 100)
        y = random.randint(100, viewport["height"] - 100)
        await page.mouse.move(x, y)
        await page.wait_for_timeout(random.uniform(100, 500))


async def scroll_to_element(page, selector):
    """
    اسکرول طبیعی به سمت یک المان خاص
    """
    element = await page.query_selector(selector)
    if element:
        # موقعیت المان را پیدا کن
        box = await element.bounding_box()
        if box:
            # اسکرول تدریجی به سمت المان
            viewport = page.viewport_size
            target_y = box["y"] - viewport["height"] / 3

            current_scroll = await page.evaluate("window.pageYOffset")
            distance = target_y - current_scroll

            # اسکرول در چند مرحله
            steps = max(3, int(abs(distance) / 200))
            step_distance = distance / steps

            for step in range(steps):
                await human_like_scroll(page, step_distance, 20)
                await page.wait_for_timeout(random.uniform(200, 800))


async def extract_with_github_vision(page, url: str) -> dict:
    try:
        # screen shot of page
        screenshot_bytes = await page.screenshot(full_page=False)
        screenshot_base64 = base64.b64encode(screenshot_bytes).decode('utf-8')

        # page txt
        page_text = await page.evaluate("() => document.body.innerText")

        system_prompt = """شما یک استخراج‌کننده حرفه‌ای داده از آگهی‌های املاک هستید.
از تصویر و متن صفحه، اطلاعات را با دقت کامل استخراج می‌کنید."""

        user_prompt = f"""
تصویر صفحه آگهی دیوار و متن آن را می‌بینید.

لطفاً این اطلاعات را دقیق استخراج کنید:

1. **متراژ** (area): عدد متراژ (50-300 متر)
2. **قیمت کل** (price): به میلیون تومان - بدون گرد کردن
3. **قیمت هر متر** (price_per_meter): به میلیون تومان
4. **سال ساخت** (year): سال شمسی (1380-1403)
5. **تعداد اتاق** (room): 1 تا 5
6. **طبقه** (level_pos): عدد طبقه
7. **آسانسور** (belevator): 1 یا 0
8. **پارکینگ** (bparking): 1 یا 0
9. **انباری** (bwarehouse): 1 یا 0
10. **عنوان** (title): عنوان کامل
11. **توضیحات** (description): توضیحات کامل

 **خیلی مهم:**
- متراژ ≠ تعداد اتاق! (متراژ مثلاً 75، اتاق مثلاً 2)
- اگر "نوساز" دیدید، سال = 1403
- اگر چیزی پیدا نکردید: area=100, room=2, year=1400
- فقط JSON خروجی

متن صفحه:
{page_text[:2500]}

خروجی (فقط JSON):
{{
  "area": 75,
  "price": 3100.0,
  "price_per_meter": 41.333,
  "year": 1391,
  "room": 2,
  "level_pos": 1,
  "belevator": 1,
  "bparking": 1,
  "bwarehouse": 1,
  "title": "عنوان",
  "description": "توضیحات..."
}}
"""

        # call model
        response = client.complete(
            messages=[
                SystemMessage(content=system_prompt),
                UserMessage(content=[
                    {
                        "type": "text",
                        "text": user_prompt
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{screenshot_base64}"
                        }
                    }
                ])
            ],
            model=model_name,
            temperature=0.1,
            max_tokens=1000
        )

        text_content = response.choices[0].message.content.strip()

        # clear backtricks
        if text_content.startswith("```"):
            text_content = text_content.split("```")[1]
            if text_content.startswith("json"):
                text_content = text_content[4:]
            text_content = text_content.strip()

        data = json.loads(text_content)

        data["ad_link"] = url

        if data.get("area", 0) > 0 and data.get("price", 0) > 0:
            data["vpm"] = data["price"] / data["area"]
        else:
            data["vpm"] = 0

        # default value
        defaults = {
            "area": 100, "price": 0, "price_per_meter": 0, "year": 1400,
            "room": 2, "level_pos": 1, "levels": 1, "units": 1,
            "belevator": 0, "bparking": 0, "bwarehouse": 0,
            "neighborhood": "گرگان", "title": "", "description": "",
            "image_url": "", "x_1": 0, "y_1": 0
        }
        for key, default_val in defaults.items():
            if key not in data:
                data[key] = default_val

        # get image, download it from ads
        try:
            img_elem = await page.query_selector("img[src*='divarcdn']")
            if img_elem:
                data["image_url"] = await img_elem.get_attribute("src") or ""
        except:
            pass

        return data

    except Exception as e:
        logger.error(f"خطا در Vision AI: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None


async def simulate_human_behavior(page):
    """
    شبیه‌سازی رفتار انسانی برای طبیعی‌تر شدن
    """
    # حرکت تصادفی موس
    viewport = page.viewport_size
    for _ in range(random.randint(2, 5)):
        x = random.randint(100, viewport["width"] - 100)
        y = random.randint(100, viewport["height"] - 100)
        await page.mouse.move(x, y)
        await page.wait_for_timeout(random.uniform(200, 800))

    # کلیک تصادفی (اما نه روی لینک‌ها)
    if random.random() > 0.8:
        await page.mouse.click(
            random.randint(100, viewport["width"] - 100),
            random.randint(100, viewport["height"] - 100),
            delay=random.uniform(100, 300)
        )
        await page.wait_for_timeout(random.uniform(1000, 3000))


async def collect_ad_links_human(page, target_count=30):
    """
    جمع‌آوری لینک‌های آگهی با رفتار انسانی
    """
    await page.goto(CATEGORY_URL, timeout=60000)
    logger.info("📱 در حال بارگذاری صفحه دیوار...")

    # صبر برای لود کامل صفحه
    await page.wait_for_timeout(3000)

    # رفتار انسانی اولیه
    await simulate_human_behavior(page)

    all_links = []
    scroll_attempts = 0
    max_scroll_attempts = 20
    last_link_count = 0
    no_progress_count = 0

    logger.info("🔄 شروع اسکرول طبیعی مانند انسان...")

    while len(all_links) < target_count and scroll_attempts < max_scroll_attempts:
        scroll_attempts += 1

        # الگوی اسکرول تصادفی
        scroll_pattern = random.choice([
            ("slow", 3),  # اسکرول آهسته
            ("medium", 5),  # اسکرول متوسط
            ("fast", 8),  # اسکرول سریع
            ("mixed", random.randint(4, 7))  # ترکیبی
        ])

        pattern, num_scrolls = scroll_pattern

        logger.debug(f"الگوی اسکرول {scroll_attempts}: {pattern} ({num_scrolls} حرکت)")

        for i in range(num_scrolls):
            # فاصله اسکرول متفاوت
            if pattern == "slow":
                distance = random.randint(150, 300)
            elif pattern == "medium":
                distance = random.randint(300, 600)
            elif pattern == "fast":
                distance = random.randint(600, 1000)
            else:  # mixed
                distance = random.randint(200, 800)

            await human_like_scroll(page, distance)

            # گاهی اوقات اسکرول به بالا
            if random.random() > 0.9 and i > 2:  # 10% مواقع
                await page.wait_for_timeout(random.uniform(500, 1500))
                await human_like_scroll(page, -random.randint(100, 300))

        # توقف بین الگوهای اسکرول
        pause_time = random.uniform(1.5, 4.0)
        await page.wait_for_timeout(pause_time * 1000)

        # رفتار انسانی تصادفی
        if random.random() > 0.6:
            await simulate_human_behavior(page)

        # جمع‌آوری لینک‌ها
        try:
            current_links = await page.eval_on_selector_all(
                "a[href^='/v/']",
                "els => els.map(e => e.getAttribute('href'))"
            )

            unique_current = list(set(current_links))
            new_links = [link for link in unique_current if link not in all_links]

            if new_links:
                all_links.extend(new_links)
                logger.info(f"✓ اسکرول {scroll_attempts}: {len(new_links)} آگهی جدید - مجموع: {len(all_links)}")
                no_progress_count = 0
            else:
                no_progress_count += 1
                logger.debug(f"⏸️  اسکرول {scroll_attempts}: آگهی جدیدی یافت نشد")

            # بررسی پیشرفت
            if len(all_links) == last_link_count:
                no_progress_count += 1
            else:
                no_progress_count = 0

            last_link_count = len(all_links)

            # اگر پیشرفتی نبود، تغییر تاکتیک
            if no_progress_count >= 5:
                logger.info("🔄 تغییر تاکتیک اسکرول...")
                # اسکرول به بالا و دوباره به پایین
                await page.evaluate("window.scrollTo(0, 0)")
                await page.wait_for_timeout(2000)
                no_progress_count = 0

            # اگر به هدف رسیدیم، متوقف شو
            if len(all_links) >= target_count:
                logger.info(f"🎯 به هدف {target_count} آگهی رسیدیم!")
                break

        except Exception as e:
            logger.error(f"خطا در جمع‌آوری لینک‌ها: {e}")
            await page.wait_for_timeout(3000)

    # محدود کردن به تعداد مورد نظر
    all_links = list(set(all_links))[:target_count]
    full_links = [f"https://divar.ir{link}" for link in all_links]

    logger.info(f"✅ در مجموع {len(full_links)} آگهی با رفتار انسانی جمع‌آوری شد")
    return full_links


async def process_ad_page(page, link, index, total):
    """
    پردازش یک صفحه آگهی با رفتار طبیعی
    """
    logger.info(f"\n{'=' * 70}")
    logger.info(f"📍 [{index}/{total}] در حال پردازش آگهی...")

    try:
        # رفتن به صفحه آگهی با تأخیر طبیعی
        await page.wait_for_timeout(random.uniform(1000, 3000))
        await page.goto(link, timeout=40000, wait_until="domcontentloaded")

        # رفتار انسانی قبل از استخراج
        await simulate_human_behavior(page)

        # اسکرول طبیعی در صفحه آگهی
        for _ in range(random.randint(1, 3)):
            await human_like_scroll(page, random.randint(200, 500))

        # صبر برای لود کامل
        await page.wait_for_timeout(random.uniform(2000, 4000))

        # استخراج اطلاعات
        logger.info("🤖 در حال استخراج اطلاعات با مدل بینایی...")
        ad_data = await extract_with_github_vision(page, link)

        if ad_data:
            logger.info(f"✅ استخراج موفق: {ad_data['title'][:20]}...")
            return ad_data
        else:
            logger.warning("❌ استخراج ناموفق")
            return None

    except Exception as e:
        logger.error(f"خطا در پردازش آگهی: {e}")
        return None


async def main():
    all_ads = []

    logger.info("🚀 شروع استخراج آگهی‌های دیوار با رفتار انسانی")
    logger.info("🎯 هدف: جمع‌آوری ۳۰ آگهی")

    async with async_playwright() as p:
        # راه‌اندازی مرورگر با تنظیمات طبیعی‌تر
        browser = await p.chromium.launch(
            headless=False,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        )

        # ایجاد context با fingerprint طبیعی‌تر
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1366, "height": 768},
            locale='fa-IR',
            timezone_id='Asia/Tehran',
            permissions=['geolocation'],
            geolocation={"latitude": 36.8456, "longitude": 54.4393},  # گرگان
            color_scheme='light'
        )

        # جلوگیری از تشخیص automation
        await context.add_init_script("""
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
            Object.defineProperty(navigator, 'webdriver', {get: () => false});
        """)

        page = await context.new_page()

        # جمع‌آوری لینک‌ها با رفتار انسانی
        logger.info("\n" + "=" * 70)
        logger.info("🕵️‍♂️ در حال جمع‌آوری لینک‌های آگهی با رفتار انسانی...")
        ad_links = await collect_ad_links_human(page, target_count=30)

        if not ad_links:
            logger.error("❌ هیچ لینک آگهی‌ای یافت نشد!")
            await browser.close()
            return []

        logger.info(f"✅ {len(ad_links)} لینک آگهی جمع‌آوری شد")

        # پردازش آگهی‌ها
        logger.info("\n" + "=" * 70)
        logger.info("🔍 شروع پردازش آگهی‌ها...")

        for i, link in enumerate(ad_links[:30], 1):
            ad_data = await process_ad_page(page, link, i, len(ad_links))

            if ad_data:
                all_ads.append(ad_data)

                # نمایش خلاصه اطلاعات
                logger.info(f"""
    📊 خلاصه آگهی {i}:
      عنوان: {ad_data.get('title', '')[:40]}...
      متراژ: {ad_data.get('area', 0)} متر | اتاق: {ad_data.get('room', 0)}
      قیمت: {ad_data.get('price', 0):,.0f} میلیون
      سال: {ad_data.get('year', 1400)} | طبقه: {ad_data.get('level_pos', 0)}
                """)

            # تأخیر طبیعی بین آگهی‌ها
            if i < len(ad_links):
                delay = random.uniform(3, 8)
                logger.info(f"⏳ تأخیر طبیعی {delay:.1f} ثانیه...")
                await page.wait_for_timeout(delay * 1000)

        await browser.close()

    # ذخیره اطلاعات
    output_file = "divar_ads_human_like.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(all_ads, f, ensure_ascii=False, indent=2)

    # آمار نهایی
    logger.info(f"\n{'=' * 70}")
    logger.info(f"🎉 ماموریت تکمیل شد!")
    logger.info(f"📁 {len(all_ads)} آگهی در {output_file} ذخیره شد")

    if all_ads:
        with_price = [a for a in all_ads if a.get("price", 0) > 0]
        avg_area = sum(a.get("area", 0) for a in all_ads) / len(all_ads) if all_ads else 0

        logger.info(f"\n📊 آمار نهایی:")
        logger.info(f"   تعداد آگهی‌ها: {len(all_ads)}")
        logger.info(f"   آگهی‌های قیمت‌دار: {len(with_price)}")
        logger.info(f"   میانگین متراژ: {avg_area:.0f} متر")
        logger.info(f"   دارای پارکینگ: {sum(a.get('bparking', 0) for a in all_ads)}")
        logger.info(f"   دارای آسانسور: {sum(a.get('belevator', 0) for a in all_ads)}")

    return all_ads


if __name__ == "__main__":
    print("\n" + "=" * 70)
    print("🤖 استخراج‌کننده هوشمند آگهی‌های دیوار")
    print("👤 با رفتار کاملاً انسانی برای جلوگیری از تشخیص ربات")
    print("=" * 70 + "\n")

    try:
        ads = asyncio.run(main())
        print(f"\n✅ موفقیت‌آمیز! {len(ads)} آگهی استخراج شد.")
    except KeyboardInterrupt:
        print("\n\n⏹️  عملیات توسط کاربر متوقف شد.")
    except Exception as e:
        print(f"\n❌ خطا: {e}")
        import traceback

        traceback.print_exc()