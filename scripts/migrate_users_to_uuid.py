"""Safe-ish migration to convert `users.id` from INTEGER to UUID.

Usage:
    source .venv/bin/activate
    python scripts/migrate_users_to_uuid.py

What it does:
- creates a backup table `users_backup_<ts>`
- enables a UUID extension if missing (tries pgcrypto, then uuid-ossp)
- adds a new `id_new UUID` column with default gen_random_uuid()
- populates `id_new` for all rows
- drops the old primary key and `id` column, renames `id_new` to `id`
- recreates primary key on `id`

WARNING: If other tables have foreign keys referencing `users.id`, those FK constraints will now point to the old integer values and must be updated manually. Inspect and update FKs before running in production.

This script is offered as a convenience. Review and run on a copy of your DB first.
"""

import os
import time
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DB_HOST = os.getenv("HOST")
DB_PORT = os.getenv("PORT")
DB_NAME = os.getenv("DATABASE")
DB_USER = os.getenv("USER")
DB_PASS = os.getenv("PASSWORD")

DSN = dict(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASS)

BACKUP_TABLE = f"users_backup_{int(time.time())}"

SQL = [
    # create backup
    f"CREATE TABLE {BACKUP_TABLE} AS TABLE users;",
    # try to enable gen_random_uuid (pgcrypto) or uuid_generate_v4 (uuid-ossp)
    "CREATE EXTENSION IF NOT EXISTS pgcrypto;",
    "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";",
    # add new column
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS id_new UUID;",
    # set defaults and populate
    "UPDATE users SET id_new = gen_random_uuid() WHERE id_new IS NULL;",
    # ensure no NULLs remain
    "ALTER TABLE users ALTER COLUMN id_new SET NOT NULL;",
    # drop old primary key constraint if exists
    "DO $$\nBEGIN\n  IF (SELECT conname FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'p') IS NOT NULL THEN\n    EXECUTE ('ALTER TABLE users DROP CONSTRAINT ' || (SELECT conname FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'p'));\n  END IF;\nEND$$;",
    # drop old id column
    "ALTER TABLE users DROP COLUMN IF EXISTS id;",
    # rename id_new to id
    "ALTER TABLE users RENAME COLUMN id_new TO id;",
    # make sure default exists
    "ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();",
    # add primary key
    "ALTER TABLE users ADD PRIMARY KEY (id);",
]


def run():
    print("This will attempt to migrate users.id from integer to UUID.\nPlease ensure you have a full DB backup before proceeding.")
    proceed = input("Type YES to proceed: ")
    if proceed != "YES":
        print("Aborting")
        return

    conn = None
    try:
        conn = psycopg2.connect(**DSN)
        conn.autocommit = False
        cur = conn.cursor()

        print(f"Creating backup table: {BACKUP_TABLE}")
        cur.execute(SQL[0])

        print("Enabling extensions (pgcrypto and uuid-ossp if available)")
        cur.execute(SQL[1])
        cur.execute(SQL[2])

        print("Adding id_new column and populating UUIDs")
        cur.execute(SQL[3])
        cur.execute(SQL[4])
        cur.execute(SQL[5])

        print("Replacing primary key and swapping columns")
        # drop PK if exists
        cur.execute(SQL[6])
        cur.execute(SQL[7])
        cur.execute(SQL[8])
        cur.execute(SQL[9])
        cur.execute(SQL[10])

        conn.commit()
        print("Migration complete. Backup table:", BACKUP_TABLE)
        print("IMPORTANT: If other tables reference users.id with foreign keys, update those FK values and constraints to use the new UUIDs stored in users.id.")

    except Exception as e:
        if conn:
            conn.rollback()
        print("Migration failed:", e)
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    run()
