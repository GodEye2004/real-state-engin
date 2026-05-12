"""Inspect `users` table: show column types and sample id values.

Run from repo root (recommended inside your .venv):
    source .venv/bin/activate
    python scripts/inspect_db.py

This script prints a short, safe summary (no full data dump).
"""
import os
from dotenv import load_dotenv
import json

load_dotenv()

DB_HOST = os.getenv("HOST")
DB_PORT = os.getenv("PORT")
DB_NAME = os.getenv("DATABASE")
DB_USER = os.getenv("USER")
DB_PASS = os.getenv("PASSWORD")

try:
    import psycopg2
except Exception as e:
    print(json.dumps({"error": "psycopg2 not available in this environment", "detail": str(e)}))
    raise

DSN = dict(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS)

def inspect():
    conn = None
    try:
        conn = psycopg2.connect(**DSN)
        cur = conn.cursor()

        cur.execute("""
            SELECT column_name, data_type, udt_name
            FROM information_schema.columns
            WHERE table_name = 'users'
            ORDER BY ordinal_position;
        """)
        cols = cur.fetchall()

        cur.execute("SELECT id FROM users LIMIT 5;")
        rows = cur.fetchall()

        out = {
            "columns": [{"name": c[0], "data_type": c[1], "udt_name": c[2]} for c in cols],
            "sample_ids": [r[0] for r in rows],
        }

        print(json.dumps(out, default=str, indent=2))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    inspect()
