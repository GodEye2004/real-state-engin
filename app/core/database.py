from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base
import os
from dotenv import load_dotenv

load_dotenv()

DB_HOST = os.getenv("HOST")
DB_PORT = os.getenv("PORT")
DB_NAME = os.getenv("DATABASE")
DB_USER = os.getenv("USER")
DB_PASS = os.getenv("PASSWORD")

# Build asyncpg URL
DATABASE_URL = (
    f"postgresql+asyncpg://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)

engine = create_async_engine(DATABASE_URL, echo=False)

AsyncSessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

Base = declarative_base()

__all__ = ["engine", "AsyncSessionLocal", "Base"]


async def init_db():
    """Create database tables from ORM models. Run once after installing DB driver and configuring DB."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
