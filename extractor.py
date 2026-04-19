# import base64
# import json
# import re
# from azure.ai.inference import ChatCompletionsClient
# from azure.ai.inference.models import SystemMessage, UserMessage
# from azure.core.credentials import AzureKeyCredential
# from config import GITHUB_TOKEN, ENDPOINT, MODEL_NAME, logger
# from utils import _normalize_prices

# client = ChatCompletionsClient(
#     endpoint=ENDPOINT,
#     credential=AzureKeyCredential(GITHUB_TOKEN),
# )

# async def extract_with_github_vision(page, url: str) -> dict:
#     try:
#         screenshot_bytes = await page.screenshot(full_page=False)
#         screenshot_base64 = base64.b64encode(screenshot_bytes).decode("utf-8")
#         page_text = await page.evaluate("() => document.body.innerText")

#         system_prompt = """شما یک استخراج‌کننده حرفه‌ای داده از آگهی‌های املاک هستید. 
#         لطفا تمام فیلدهای زیر را استخراج کنید:
#         - title (عنوان)
#         - description (توضیحات)
#         - area (متراژ به متر مربع)
#         - price (قیمت به میلیون تومان)
#         - price_per_meter (قیمت هر متر به میلیون تومان)
#         - year (سال ساخت)
#         - room (تعداد اتاق)
#         - bedrooms (تعداد خواب)
#         - level_pos (طبقه)
#         - levels (تعداد کل طبقات)
#         - belevator (آسانسور: 1 یا 0)
#         - bparking (پارکینگ: 1 یا 0)
#         - bwarehouse (انباری: 1 یا 0)
#         - city (شهر)
#         - neighborhood (محله)
#         - document_type (نوع سند)
#         - is_renovated (نوسازی شده: true/false یا 1/0)
#         - open_to_exchange (آماده معاوضه: true/false یا 1/0)
#         """

#         user_prompt = f"""
#         لطفا تمام فیلدهای بالا را از متن زیر استخراج کنید و به صورت JSON برگردانید.
#         متن:
#         {page_text[:3000]}
#         """

#         response = client.complete(
#             messages=[
#                 SystemMessage(content=system_prompt),
#                 UserMessage(content=[
#                     {"type": "text", "text": user_prompt},
#                     {
#                         "type": "image_url",
#                         "image_url": {
#                             "url": f"data:image/png;base64,{screenshot_base64}"
#                         }
#                     }
#                 ])
#             ],
#             model=MODEL_NAME,
#             temperature=0.1,
#             max_tokens=1000
#         )

#         text = response.choices[0].message.content.strip()

#         if text.startswith("```"):
#             lines = text.split("\n")
#             if lines[0].startswith("```json"):
#                 text = "\n".join(lines[1:-1])
#             else:
#                 text = text.strip("```").strip()
        
#         try:
#             data = json.loads(text)
#         except:
#             json_match = re.search(r'\{.*\}', text, re.DOTALL)
#             if json_match:
#                 data = json.loads(json_match.group())
#             else:
#                 logger.error(f"Failed to parse JSON from response: {text[:200]}")
#                 return None

#         data["ad_link"] = url
#         try:
#             img = await page.query_selector("img[src*='divarcdn']")
#             if img:
#                 data["image_url"] = await img.get_attribute("src") or ""
#         except:
#             data["image_url"] = ""

#         data = _normalize_prices(data)
#         return data

#     except Exception as e:
#         logger.error(f"Vision error: {e}")
#         return None



# 


import base64
import json
import re
import httpx
from utils import _normalize_prices
from config import logger

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
    text = fa_to_en(text).replace(",", "")
    match = re.search(r"(\d+(\.\d+)?)", text)
    if match:
        try:
            val = float(match.group(1))
            return int(val) if val.is_integer() else val
        except:
            return 0
    return 0

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

        desc_elem = await page.query_selector(".kt-description-row__text, .kt-description-row")
        if desc_elem:
            data["description"] = (await desc_elem.inner_text()).strip()

        # ۲. استخراج مشخصات از جدول
        rows = await page.query_selector_all(".kt-unexpandable-row, .kt-base-row")
        for row in rows:
            label_elem = await row.query_selector(".kt-base-row__label")
            value_elem = await row.query_selector(".kt-base-row__value")
            if not label_elem or not value_elem: continue
            
            label = await label_elem.inner_text()
            value = await value_elem.inner_text()
            
            if "قیمت کل" in label:
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

        # ۳. استخراج مشخصات از باکس آیتم‌ها (متراژ، اتاق، سال)
        items = await page.query_selector_all(".kt-group-row-item")
        for item in items:
            label_elem = await item.query_selector(".kt-group-row-item__label")
            value_elem = await item.query_selector(".kt-group-row-item__value")
            if not label_elem or not value_elem: continue
            
            label = await label_elem.inner_text()
            value = await value_elem.inner_text()
            
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

        # ۵. استخراج طبقه
        level_row = await page.query_selector(".kt-base-row:has-text('طبقه')")
        if level_row:
            level_val_elem = await level_row.query_selector(".kt-base-row__value")
            if level_val_elem:
                level_text = await level_val_elem.inner_text()
                # معمولا به صورت "۳ از ۵" است
                if "از" in level_text:
                    parts = level_text.split("از")
                    data["level_pos"] = extract_number(parts[0])
                    data["levels"] = extract_number(parts[1])
                else:
                    data["level_pos"] = extract_number(level_text)

        # ۶. تصویر آگهی
        img = await page.query_selector("img[src*='divarcdn']")
        if img:
            data["image_url"] = await img.get_attribute("src") or ""

        # نرمال‌سازی نهایی
        data = _normalize_prices(data)
        return data

    except Exception as e:
        logger.error(f"Rule-based extraction error: {e}")
        return None
