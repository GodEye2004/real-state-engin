import psycopg2
from datetime import datetime
from config import DB_CONFIG, logger

def create_database_connection():
    """ایجاد اتصال به دیتابیس"""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        return conn
    except Exception as e:
        logger.error(f"خطا در اتصال به دیتابیس: {e}")
        return None

def create_table_if_not_exists():
    """ایجاد جدول اگر وجود ندارد"""
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS divar_data (
        id SERIAL PRIMARY KEY,
        external_id VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        owner_phone VARCHAR(20),
        title VARCHAR(500),
        description TEXT,
        property_type VARCHAR(50),
        transaction_type VARCHAR(50),
        price BIGINT,
        area INTEGER,
        vpm INTEGER,
        price_per_meter BIGINT,
        city VARCHAR(100),
        district VARCHAR(200),
        bedrooms INTEGER,
        year_built INTEGER,
        floor INTEGER,
        total_floors INTEGER,
        units INTEGER,
        document_type VARCHAR(100),
        has_parking BOOLEAN,
        has_elevator BOOLEAN,
        has_storage BOOLEAN,
        is_renovated BOOLEAN,
        open_to_exchange BOOLEAN,
        exchange_preferences TEXT,
        source_link TEXT,
        image_url TEXT,
        extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        extraction_source VARCHAR(50) DEFAULT 'divar'
    );
    
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'divar_data_source_link_key'
        ) THEN
            ALTER TABLE divar_data ADD CONSTRAINT divar_data_source_link_key UNIQUE (source_link);
        END IF;
    END $$;
    
    CREATE INDEX IF NOT EXISTS idx_divar_data_city ON divar_data(city);
    CREATE INDEX IF NOT EXISTS idx_divar_data_price ON divar_data(price);
    CREATE INDEX IF NOT EXISTS idx_divar_data_area ON divar_data(area);
    CREATE INDEX IF NOT EXISTS idx_divar_data_created_at ON divar_data(created_at);
    CREATE INDEX IF NOT EXISTS idx_divar_data_status ON divar_data(status);
    """
    
    conn = create_database_connection()
    if conn:
        try:
            cursor = conn.cursor()
            cursor.execute(create_table_sql)
            conn.commit()
            logger.info("✅ جدول divar_data ایجاد شد یا از قبل موجود بود")
            cursor.close()
        except Exception as e:
            logger.error(f"خطا در ایجاد جدول: {e}")
        finally:
            conn.close()

def save_to_database(data: dict) -> bool:
    """ذخیره داده در دیتابیس"""
    insert_sql = """
    INSERT INTO divar_data (
        external_id, status, created_at, updated_at, owner_phone,
        title, description, property_type, transaction_type,
        price, area, vpm, price_per_meter, city, district,
        bedrooms, year_built, floor, total_floors, units,
        document_type, has_parking, has_elevator, has_storage,
        is_renovated, open_to_exchange, exchange_preferences,
        source_link, image_url
    ) VALUES (
        %(external_id)s, %(status)s, %(created_at)s, %(updated_at)s, %(owner_phone)s,
        %(title)s, %(description)s, %(property_type)s, %(transaction_type)s,
        %(price)s, %(area)s, %(vpm)s, %(price_per_meter)s, %(city)s, %(district)s,
        %(bedrooms)s, %(year_built)s, %(floor)s, %(total_floors)s, %(units)s,
        %(document_type)s, %(has_parking)s, %(has_elevator)s, %(has_storage)s,
        %(is_renovated)s, %(open_to_exchange)s, %(exchange_preferences)s,
        %(source_link)s, %(image_url)s
    )
    ON CONFLICT (source_link) 
    DO UPDATE SET
        updated_at = EXCLUDED.updated_at,
        price = EXCLUDED.price,
        title = EXCLUDED.title,
        status = EXCLUDED.status
    RETURNING id;
    """
    
    conn = create_database_connection()
    if not conn:
        return False
    
    try:
        cursor = conn.cursor()
        if 'external_id' not in data and 'id' in data:
            data['external_id'] = data['id']
        
        cursor.execute(insert_sql, data)
        record_id = cursor.fetchone()[0]
        conn.commit()
        logger.info(f"✅ داده با ID {record_id} در دیتابیس ذخیره شد")
        cursor.close()
        return True
    except Exception as e:
        logger.error(f"❌ خطا در ذخیره داده در دیتابیس: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()

def update_ad_status(source_link: str, new_status: str):
    """به‌روزرسانی وضعیت یک آگهی در دیتابیس"""
    conn = create_database_connection()
    if not conn:
        return False
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE divar_data SET status = %s, updated_at = %s WHERE source_link = %s",
            (new_status, datetime.now(), source_link)
        )
        conn.commit()
        cursor.close()
        return True
    except Exception as e:
        logger.error(f"Error updating status in DB: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()
