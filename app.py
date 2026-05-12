import re

import psycopg2
from fastapi import FastAPI, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
import uuid
import asyncio
from main import scrape_ads
from core.config import DB_HOST, DB_NAME, DB_PASS, DB_PORT, DB_USER, logger
from engin.search_engine import search as engine_search, extract_properties
from fastapi import Query, HTTPException
from routers.auth import router as auth_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

tasks = {}


def fa_to_en(text):
    fa_digits = "۰۱۲۳۴۵۶۷۸۹"
    en_digits = "0123456789"
    table = str.maketrans(fa_digits, en_digits)
    return text.translate(table)


def parse_smart_query(query: str):
    """
    پارسر هوشمند برای استخراج قیمت، متراژ و شهر از متن جستجو
    """
    if not query:
        return {}

    query = fa_to_en(query).lower()
    params = {"max_price": None, "min_area": None, "city": None, "keywords": []}

    # ۱. استخراج قیمت (میلیارد)
    billion_pattern = r"(\d+(\.\d+)?)\s*(میلیارد|billion|b)"
    billion_match = re.search(billion_pattern, query)
    if billion_match:
        val = float(billion_match.group(1))
        params["max_price"] = int(val * 1_000_000_000)
        query = re.sub(billion_pattern, "", query)

    # ۲. استخراج قیمت (میلیون)
    million_pattern = r"(\d+(\.\d+)?)\s*(میلیون|million|m)"
    million_match = re.search(million_pattern, query)
    if million_match:
        val = float(million_match.group(1))
        params["max_price"] = int(val * 1_000_000)
        query = re.sub(million_pattern, "", query)

    # ۳. استخراج متراژ (با کلمات متر، متری، متراژ)
    area_pattern = r"(\d+)\s*(متر|متری|متراژ|metri|meter|m2|sqm)"
    area_match = re.search(area_pattern, query)
    if area_match:
        params["min_area"] = int(area_match.group(1))
        query = re.sub(area_pattern, "", query)

    # ۴. استخراج اعداد بزرگ (اگر کاربر مستقیم عدد زد مثل ۵۰۰۰۰۰۰)
    large_num_match = re.search(r"(\d{5,})", query)
    if large_num_match:
        num = int(large_num_match.group(1))
        if num > 10000:  # احتمالا قیمت است
            params["max_price"] = num
        query = re.sub(r"\d{5,}", "", query)

    # ۵. شناسایی عدد تنها به عنوان متراژ (اگر کوچک باشد و قیمت قبلا پیدا نشده باشد)
    if not params["min_area"]:
        small_num_match = re.search(r"\b(\d{2,3})\b", query)
        if small_num_match:
            val = int(small_num_match.group(1))
            if 20 <= val <= 500:  # بازه منطقی برای متراژ
                params["min_area"] = val
                query = re.sub(r"\b\d{2,3}\b", "", query)

    # ۶. کلمات باقی‌مانده (برای شهر و عنوان)
    keywords = [w.strip() for w in query.split() if len(w.strip()) > 1]
    params["keywords"] = keywords

    return params


async def run_scraping_task(task_id: str, city: str, duration_minutes: int):
    tasks[task_id]["status"] = "running"
    tasks[task_id]["city"] = city
    tasks[task_id]["remaining_seconds"] = duration_minutes * 60
    tasks[task_id]["results_count"] = 0

    async def countdown():
        while (
            tasks[task_id]["remaining_seconds"] > 0
            and tasks[task_id]["status"] == "running"
        ):
            await asyncio.sleep(1)
            tasks[task_id]["remaining_seconds"] -= 1

    asyncio.create_task(countdown())

    try:
        while (
            tasks[task_id]["remaining_seconds"] > 0
            and tasks[task_id]["status"] == "running"
        ):
            logger.info(f"Starting a new scraping cycle for task {task_id}")
            results = await scrape_ads(
                should_stop=lambda: tasks[task_id].get("remaining_seconds", 0) <= 0
            )

            # بروزرسانی تعداد کل یافته‌ها
            tasks[task_id]["results_count"] += len(results)

            if tasks[task_id]["remaining_seconds"] > 0:
                logger.info(
                    f"⏳ Cycle finished. Waiting 30 seconds before next check. Remaining: {tasks[task_id]['remaining_seconds']}s"
                )
                await asyncio.sleep(30)
            else:
                break

        tasks[task_id]["status"] = "completed"
    except Exception as e:
        logger.error(f"Error in task {task_id}: {e}")
        tasks[task_id]["status"] = "failed"
        tasks[task_id]["error"] = str(e)


app.include_router(auth_router)

# not use in app
@app.post("/scrape")
async def start_scrape(data: dict, background_tasks: BackgroundTasks):
    city = data.get("city", "گرگان")
    duration = data.get("duration_minutes", 1)

    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        "status": "starting",
        "city": city,
        "remaining_seconds": duration * 60,
        "results_count": 0,
    }

    background_tasks.add_task(run_scraping_task, task_id, city, duration)
    return {"task_id": task_id}

# not use in app
@app.get("/tasks/{task_id}")
async def get_task_status(task_id: str):
    if task_id not in tasks:
        return {"status": "not_found"}
    return tasks[task_id]



#  cal it when we want searching properties
@app.get("/ads")
async def get_ads(q: str = Query(None)):
    # 1. Start with a base query
    base_query = "SELECT * FROM properties WHERE 1=1"
    params = {}

    # 2. Extract intelligence from the prompt (LLM)
    props = extract_properties(q) if q else None

    # 3. Dynamically build the SQL query based on filters
    if props:
        if props.budget:
            base_query += " AND price <= %(budget)s"
            params["budget"] = props.budget

        if props.area:
            base_query += " AND area >= %(area)s"
            params["area"] = props.area

        if props.rooms:
            base_query += " AND bedrooms >= %(rooms)s"
            params["rooms"] = props.rooms

        if props.elevator:
            base_query += " AND has_elevator = TRUE"

    # 4. Execute the query
    try:
        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS
        )
        # Using RealDictCursor makes it easy to return results as JSON-ready dicts
        from psycopg2.extras import RealDictCursor

        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute(base_query, params)
        results = cursor.fetchall()

        cursor.close()
        conn.close()

        return results

    except Exception as e:
        logger.error(f"Database error: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")


@app.post("/talk_to_agent")
async def talk_to_agent(payload: dict):
    q = payload.get("query") or payload.get("q")
    if not q:
        raise HTTPException(status_code=400, detail="Missing 'query' in payload")

    props = extract_properties(q)
    logger.info(f"Extracted props: {props.__dict__ if props else {}}")

    base_query = "SELECT * FROM properties WHERE 1=1"
    params = {}

    # Price: 50% to 120% of stated budget
    if getattr(props, "budget", None):
        budget = int(float(props.budget))
        params["min_price"] = int(budget * 0.5)
        params["max_price"] = int(budget * 1.2)
        base_query += " AND price BETWEEN %(min_price)s AND %(max_price)s"
        logger.info(
            f"Budget: {budget:,} → filter {params['min_price']:,} to {params['max_price']:,}"
        )

    # Area: ±30% tolerance
    if getattr(props, "area", None):
        area = int(float(props.area))
        params["min_area"] = int(area * 0.7)
        params["max_area"] = int(area * 1.3)
        base_query += " AND area BETWEEN %(min_area)s AND %(max_area)s"

    # Rooms: exact match
    if getattr(props, "rooms", None):
        params["rooms"] = int(props.rooms)
        base_query += " AND bedrooms = %(rooms)s"

    # Elevator: only when explicitly True
    if getattr(props, "elevator", None) is True:
        base_query += " AND has_elevator = TRUE"

    # Year built
    if getattr(props, "year_built", None):
        params["year_built"] = int(props.year_built)
        base_query += " AND year_built >= %(year_built)s"

    # Order: closest price to budget first, then closest area
    if getattr(props, "budget", None) and getattr(props, "area", None):
        base_query += " ORDER BY ABS(price - %(budget_target)s) ASC, ABS(area - %(area_target)s) ASC"
        params["budget_target"] = int(float(props.budget))
        params["area_target"] = int(float(props.area))
    elif getattr(props, "budget", None):
        base_query += " ORDER BY ABS(price - %(budget_target)s) ASC"
        params["budget_target"] = int(float(props.budget))
    elif getattr(props, "area", None):
        base_query += " ORDER BY ABS(area - %(area_target)s) ASC"
        params["area_target"] = int(float(props.area))
    else:
        base_query += " ORDER BY created_at DESC"

    base_query += " LIMIT 20"

    logger.info(f"Final SQL: {base_query}")
    logger.info(f"Params: {params}")

    try:
        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS
        )
        from psycopg2.extras import RealDictCursor

        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(base_query, params)
        results = cursor.fetchall()
        cursor.close()
        conn.close()

        logger.info(f"Found {len(results)} results")

        return {
            "query": q,
            "extracted_properties": props.__dict__ if props else {},
            "results": [dict(r) for r in results],
        }
    except Exception as e:
        logger.error(f"DB error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ────────────────────────────────────────────────────────
#  SMART PROPERTY SEARCH  (word_hunter LoRA engine)
# ────────────────────────────────────────────────────────


@app.get("/search")
async def smart_search(
    q: str = Query(
        ..., description="Natural language search query (Persian or English)"
    ),
    top_k: int = Query(20, ge=1, le=100, description="Max results to return"),
):
    """
    Semantic property search powered by the word_hunter LoRA model.

    Extracts 5 properties from the query:
      - area        (متراژ)     — minimum area in m²
      - rooms       (اتاق)      — minimum number of rooms
      - elevator    (آسانسور)   — requires elevator
      - budget      (بودجه)     — maximum price in Toman
      - year_built  (سال ساخت)  — minimum year built

    Then matches against the DB using hard filters + weighted scoring.
    """
    try:
        result = engine_search(query=q, top_k=top_k)
        return result
    except Exception as e:
        logger.error(f"Search error: {e}")
        return {"error": str(e), "results": []}


@app.get("/")
async def health_check():
    return {"status": "ok", "message": "Divar Scraper API is running"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
