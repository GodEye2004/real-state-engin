import base64
import json
import re
import httpx
import requests
from utiles.utils import _normalize_prices
from core.config import logger

# OLLAMA_URL = "http://192.168.100.108:11434/v1/chat/completions"
# CHUNK_SIZE = 2500

def fa_to_en(text):
    """تبدیل اعداد فارسی به انگلیسی"""
    if not text: return ""
    fa_digits = "۰۱۲۳۴۵۶۷۸۹"
    en_digits = "0123456789"
    table = str.maketrans(fa_digits, en_digits)
    return text.translate(table)

def extract_number(text):
    """استخراج اولین عدد از متن"""
    if not text: return 0
    # تبدیل اعداد فارسی، حذف کاما (انگلیسی و فارسی) و فضاها
    text = fa_to_en(text).replace(",", "").replace("،", "").strip()
    # حذف غیرعددی‌ها به جز نقطه
    match = re.search(r"(\d+(\.\d+)?)", text)
    if match:
        try:
            val = float(match.group(1))
            return int(val) if val.is_integer() else val
        except:
            return 0
    return 0

MODEL_API_URL = "http://localhost:8001/extract"

async def _extract_with_model_api(title: str, description: str) -> dict:
    """
    Calls the Word Hunter Model API to extract features from text.
    """
    try:
        query = f"عنوان: {title}\nتوضیحات: {description}"
        logger.info(f"🤖 Calling Model API for extra features...")
        
        # Using a regular requests call (or we could use httpx.async)
        response = requests.post(MODEL_API_URL, json={"query": query}, timeout=10)
        if response.status_code == 200:
            result = response.json()
            return result.get("extraction", {})
    except Exception as e:
        logger.warning(f"⚠️ Model API extraction failed: {e}")
    return {}

async def extract_with_rules(page, url: str) -> dict:
    """
    استخراج داده با استفاده از سلکتورهای CSS و Regex (بدون نیاز به مدل)
    """
    try:
        data = {
            "title": "",
            "description": "",
            "area": 0,
            "price": 0,
            "price_per_meter": 0,
            "year": 0,
            "room": 0,
            "bedrooms": 0,
            "level_pos": 0,
            "levels": 0,
            "belevator": 0,
            "bparking": 0,
            "bwarehouse": 0,
            "city": "گرگان",
            "neighborhood": "",
            "document_type": "",
            "is_renovated": 0,
            "open_to_exchange": 0,
            "ad_link": url,
            "image_url": ""
        }

        # ۱. استخراج عنوان و توضیحات
        title_elem = await page.query_selector("h1, .kt-page-title__title")
        if title_elem:
            data["title"] = (await title_elem.inner_text()).strip()

        # تلاش برای استخراج توضیحات با سلکتورهای مختلف
        desc_selectors = [
            ".kt-description-row__text",
            ".kt-description-row",
            "section:has-text('توضیحات') .kt-base-row__value",
            ".kt-page-description"
        ]
        
        best_desc = ""
        placeholder = "موردی برای نمایش وجود ندارد"
        
        for selector in desc_selectors:
            elems = await page.query_selector_all(selector)
            for elem in elems:
                text = (await elem.inner_text()).strip()
                if text and placeholder not in text:
                    # انتخاب طولانی‌ترین متن به عنوان توضیحات واقعی
                    if len(text) > len(best_desc):
                        best_desc = text
        
        if best_desc:
            data["description"] = best_desc

        # ۲. استخراج مشخصات از جدول (Rows)
        rows = await page.query_selector_all(".kt-base-row, .kt-unexpandable-row, .kt-group-row-item")
        for row in rows:
            text = (await row.inner_text()).strip()
            if not text: continue
            
            # استخراج مستقیم امکانات اگر به صورت آیکون‌دار نیستند
            if "آسانسور" in text:
                data["belevator"] = 1 if "ندارد" not in text else 0
            elif "پارکینگ" in text:
                data["bparking"] = 1 if "ندارد" not in text else 0
            elif "انباری" in text:
                data["bwarehouse"] = 1 if "ندارد" not in text else 0
            
            # تقسیم بر اساس خط جدید برای جدا کردن لیبل و مقدار (برای سایر فیلدها)
            parts = [p.strip() for p in text.split("\n") if p.strip()]
            if len(parts) < 2: continue
            
            label = parts[0]
            value = parts[1]
            logger.info(f"Row found - Label: {label}, Value: {value}")
            
            if "قیمت کل" in label or "قیمت:" in label:
                data["price"] = extract_number(value)
            elif "قیمت هر متر" in label:
                data["price_per_meter"] = extract_number(value)
            elif "نوسازی" in label:
                data["is_renovated"] = 1 if "بله" in value or "دارد" in value else 0
            elif "معاوضه" in label:
                data["open_to_exchange"] = 1 if "بله" in value or "هست" in value else 0
            elif "سند" in label:
                data["document_type"] = value.strip()
            elif "محله" in label:
                data["neighborhood"] = value.strip()
            elif "طبقه" in label:
                if "از" in value:
                    v_parts = value.split("از")
                    data["level_pos"] = extract_number(v_parts[0])
                    data["levels"] = extract_number(v_parts[1])
                else:
                    data["level_pos"] = extract_number(value)

        # ۳. استخراج مشخصات از باکس آیتم‌ها (متراژ، اتاق، سال)
        # در دیوار، لیبل‌ها و مقادیر ممکن است جدا یا با هم باشند
        group_items = await page.query_selector_all(".kt-group-row-item")
        group_texts = [(await item.inner_text()).strip() for item in group_items]
        
        # اگر دقیقا ۶ آیتم بود، به احتمال زیاد ۳ لیبل و سپس ۳ مقدار است
        if len(group_texts) >= 6:
            for i in range(3):
                label = group_texts[i]
                value = group_texts[i+3]
                if "متراژ" in label:
                    data["area"] = extract_number(value)
                elif "اتاق" in label:
                    data["room"] = extract_number(value)
                    data["bedrooms"] = data["room"]
                elif "ساخت" in label:
                    if "نوساز" in value:
                        data["year"] = 1403
                    else:
                        data["year"] = extract_number(value)
        else:
            # روش جایگزین اگر تعداد متفاوت بود
            for i, text in enumerate(group_texts):
                if "متراژ" in text:
                    for j in range(i + 1, len(group_texts)):
                        val = extract_number(group_texts[j])
                        if val > 0:
                            data["area"] = val
                            # برای اینکه این عدد دوباره برای اتاق استفاده نشود، در لیست اصلی مارک می‌کنیم
                            group_texts[j] = "PROCESSED"
                            break
                elif "اتاق" in text:
                    for j in range(i + 1, len(group_texts)):
                        t = group_texts[j]
                        if t == "PROCESSED": continue
                        val = extract_number(t)
                        if val > 0 and val < 10: # تعداد اتاق معمولاً زیر ۱۰ است
                            data["room"] = val
                            data["bedrooms"] = val
                            group_texts[j] = "PROCESSED"
                            break
                elif "ساخت" in text:
                    for j in range(i + 1, len(group_texts)):
                        t = group_texts[j]
                        if t == "PROCESSED": continue
                        if "نوساز" in t:
                            data["year"] = 1403
                            group_texts[j] = "PROCESSED"
                            break
                        val = extract_number(t)
                        if val > 1300:
                            data["year"] = val
                            group_texts[j] = "PROCESSED"
                            break

        # ۴. استخراج امکانات (آسانسور، پارکینگ، انباری)
        features = await page.query_selector_all(".kt-group-row-item--with-icon")
        for feature in features:
            text = await feature.inner_text()
            status = "ندارد" not in text
            if "آسانسور" in text:
                data["belevator"] = 1 if status else 0
            elif "پارکینگ" in text:
                data["bparking"] = 1 if status else 0
            elif "انباری" in text:
                data["bwarehouse"] = 1 if status else 0

        # ۵. تصویر آگهی
        img = await page.query_selector("img[src*='divarcdn']")
        if img:
            data["image_url"] = await img.get_attribute("src") or ""

        # ۶. بهبود با مدل (Model API Fallback)
        # اگر اطلاعات حیاتی مثل متراژ یا قیمت پیدا نشد، یا برای پیدا کردن معاوضه و ...
        if data["title"] or data["description"]:
            model_data = await _extract_with_model_api(data["title"], data["description"])
            if model_data:
                logger.info(f"✨ Model API found additional data: {model_data}")
                
                # بروزرسانی فیلدهای خالی یا مشکوک
                if data["area"] <= 0 and "متراژ" in model_data:
                    from engin.search_engine import _parse_area_string
                    data["area"] = _parse_area_string(model_data["متراژ"]) or 0
                
                if data["price"] <= 0 and "قیمت" in model_data:
                    from engin.search_engine import _parse_budget_string
                    data["price"] = _parse_budget_string(model_data["قیمت"]) or 0
                
                if data["bedrooms"] <= 0 and "چند خواب" in model_data:
                    from engin.search_engine import _to_int
                    data["bedrooms"] = _to_int(model_data["چند خواب"]) or 0
                    data["room"] = data["bedrooms"]

                if data["open_to_exchange"] == 0 and "معاوضه" in model_data:
                    from engin.search_engine import _to_bool
                    data["open_to_exchange"] = 1 if _to_bool(model_data["معاوضه"]) else 0
                
                # امکانات
                if "امکانات" in model_data:
                    imkanat = model_data["امکانات"]
                    if isinstance(imkanat, list):
                        text_imkanat = " ".join([str(i) for i in imkanat])
                        if "آسانسور" in text_imkanat: data["belevator"] = 1
                        if "پارکینگ" in text_imkanat: data["bparking"] = 1
                        if "انباری" in text_imkanat: data["bwarehouse"] = 1

        # نرمال‌سازی نهایی
        data = _normalize_prices(data)
        logger.info(f"Final extracted data for {url}: {data}")
        return data

    except Exception as e:
        logger.error(f"Rule-based extraction error: {e}")
        return None
