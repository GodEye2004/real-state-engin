from datetime import datetime
from core.config import logger

def _map_status_from_db(status_str: str) -> str:
    """Map status string from Divar to core backend schema."""
    status_mapping = {
        "در_انتظار_تایید": "pending",
        "تایید_شده": "approved",
        "رد_شده": "rejected",
        "فروخته_شده": "sold",
        "pending": "pending",
        "approved": "approved",
        "rejected": "rejected",
        "sold": "sold",
    }
    return status_mapping.get(status_str, "pending")

def _normalize_prices(data: dict) -> dict:
    """Normalize prices from millions of tomans to tomans."""
    def to_float(val):
        try:
            if isinstance(val, str):
                # حذف کاما و فاصله‌ها
                val = val.replace(',', '').replace(' ', '')
            return float(val)
        except (ValueError, TypeError):
            return 0.0

    price = to_float(data.get("price", 0))
    if price > 0:
        # اگر عدد کمتر از ۱۰۰،۰۰۰ باشد، احتمالا به میلیون است (مثلا ۵۵۰۰ میلیون تومان)
        # اگر بیشتر باشد، احتمالا قیمت کل به تومان است
        if price < 100000:
            data["price"] = int(price * 1_000_000)
        else:
            data["price"] = int(price)
    
    price_per_meter = to_float(data.get("price_per_meter", 0))
    if price_per_meter > 0:
        if price_per_meter < 1000:
            data["price_per_meter"] = int(price_per_meter * 1_000_000)
        else:
            data["price_per_meter"] = int(price_per_meter)
    
    area = to_float(data.get("area", 0))
    if area > 0 and data.get("price", 0) > 0:
        data["vpm"] = int(data["price"] / area)
    
    return data

def _to_bool(value) -> bool:
    """تبدیل مقدار به boolean"""
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return bool(value)
    if isinstance(value, str):
        value_lower = value.lower()
        if value_lower in ['true', 'yes', '1', 'دارد', 'بله']:
            return True
        elif value_lower in ['false', 'no', '0', 'ندارد', 'خیر']:
            return False
    return False

def map_divar_to_core(data: dict, created_at, updated_at):
    year_built = data.get("year", data.get("year_built", 0))
    bedrooms = data.get("bedrooms", 0)
    if bedrooms == 0 and data.get("room", 0) > 0:
        bedrooms = data.get("room", 0)
    
    city = data.get("city", "گرگان")
    district = data.get("district", data.get("neighborhood", ""))
    total_floors = data.get("total_floors", data.get("levels", data.get("total_floor", 0)))
    floor = data.get("floor", data.get("level_pos", data.get("floor_num", 0)))
    
    is_renovated = _to_bool(data.get("is_renovated", False))
    open_to_exchange = _to_bool(data.get("open_to_exchange", False))
    
    db_data = {
        "external_id": data.get("id", f"divar_{int(datetime.now().timestamp())}"),
        "status": _map_status_from_db(data.get("status", "در_انتظار_تایید")),
        "created_at": created_at,
        "updated_at": updated_at,
        "owner_phone": data.get("owner_phone", ""),
        "title": data.get("title", ""),
        "description": data.get("description", ""),
        "property_type": data.get("property_type", "apartment"),
        "transaction_type": data.get("transaction_type", "sale"),
        "price": data.get("price", 0),
        "area": data.get("area", 0),
        "vpm": data.get("vpm", 0),
        "price_per_meter": data.get("price_per_meter", 0),
        "city": city,
        "district": district,
        "bedrooms": bedrooms,
        "year_built": year_built,
        "floor": floor,
        "total_floors": total_floors,
        "units": data.get("units", 1),
        "document_type": data.get("document_type", ""),
        "has_parking": _to_bool(data.get("bparking", 0) or data.get("has_parking", 0)),
        "has_elevator": _to_bool(data.get("belevator", 0) or data.get("has_elevator", 0)),
        "has_storage": _to_bool(data.get("bwarehouse", 0) or data.get("has_storage", 0)),
        "is_renovated": is_renovated,
        "open_to_exchange": open_to_exchange,
        "exchange_preferences": str(data.get("exchange_preferences", "")) if data.get("exchange_preferences") else "",
        "source_link": data.get("ad_link", ""),
        "image_url": data.get("image_url", ""),
    }
    
    return db_data
