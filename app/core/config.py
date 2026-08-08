import os
from dotenv import load_dotenv
import psycopg2
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

DB_HOST = os.getenv("HOST")
DB_PORT = os.getenv("PORT")
DB_NAME = os.getenv("DATABASE")
DB_USER = os.getenv("USER")
DB_PASS = os.getenv("PASSWORD")


# Category URL for scraping; can be set via environment variable CATEGORY_URL
# Example: https://divar.ir/s/some-city/real-estate
CATEGORY_URL = os.getenv("CATEGORY_URL", "https://divar.ir/s/gorgan/real-estate")


def get_db_connection():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS
    )


def save_to_db(data):
    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS
    )

    cursor = conn.cursor()

    query = """
INSERT INTO properties (
    external_id, status, created_at, updated_at,
    owner_phone, title, description,
    property_type, transaction_type,
    price, area, vpm, price_per_meter,
    city, district,
    bedrooms, year_built,
    document_type,
    has_parking, has_elevator, has_storage,
    is_renovated,
    open_to_exchange, exchange_preferences,
    source_link, image_url
)
VALUES (
    %(external_id)s, %(status)s, %(created_at)s, %(updated_at)s,
    %(owner_phone)s, %(title)s, %(description)s,
    %(property_type)s, %(transaction_type)s,
    %(price)s, %(area)s, %(vpm)s, %(price_per_meter)s,
    %(city)s, %(district)s,
    %(bedrooms)s, %(year_built)s,
    %(document_type)s,
    %(has_parking)s, %(has_elevator)s, %(has_storage)s,
    %(is_renovated)s,
    %(open_to_exchange)s, %(exchange_preferences)s,
    %(source_link)s, %(image_url)s
)
ON CONFLICT (external_id) DO NOTHING;
"""

    cursor.execute(query, data)
    logger.info(f"Saved to DB: {data['external_id']}")

    conn.commit()

    cursor.close()
    conn.close()

    return True


def load_from_db(limit=100):
    """Read properties from PostgreSQL instead of JSON"""

    conn = None
    cursor = None

    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT *
            FROM properties
            ORDER BY created_at DESC
            LIMIT %s;
        """,
            (limit,),
        )

        rows = cursor.fetchall()

        # get column names
        columns = [desc[0] for desc in cursor.description]

        result = []

        for row in rows:
            result.append(dict(zip(columns, row)))

        return result

    except Exception as e:
        print("DB read error:", e)
        return []

    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
