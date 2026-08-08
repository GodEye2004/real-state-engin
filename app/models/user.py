from sqlalchemy import Column, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from pydantic import BaseModel, ConfigDict
from core.database import Base
import uuid
from uuid import UUID


class User(Base):
    __tablename__ = "users"

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone = Column(String(32), unique=True, index=True, nullable=False)


# Pydantic schemas kept below for request/response validation


# Base property shared by create and read models
class UserBase(BaseModel):
    phone: str


class UserCreate(BaseModel):
    phone: str


class UserRead(BaseModel):
    id: UUID
    phone: str

    model_config = ConfigDict(from_attributes=True)
