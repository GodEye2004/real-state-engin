from sqlalchemy import Column, String, Boolean, DateTime, Integer
from datetime import datetime
from core.database import Base

# Pydantic schemas retained below for validation
from pydantic import BaseModel, Field, field_validator
import re


class OTPCode(Base):
    __tablename__ = "otp_codes"

    id = Column(Integer, primary_key=True)
    phone = Column(String(32), nullable=False, index=True)
    code = Column(String(16), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    is_used = Column(Boolean, default=False)


class OTPRequest(BaseModel):
    phone: str = Field(
        ...,
        example="09123456789",
    )


@field_validator("phone")
@classmethod
def validate_phone(cls, v: str):

    v = v.strip()

    if v.startswith("+98"):
        v = v.replace("+", "")

    if not re.match(r"^09\d{9}$", v):
        raise ValueError("Invalid phone number format")
    return v


class OTPVerification(OTPRequest):
    code: str = Field(..., example="1234", min_length=4, max_length=4)


class OTPResponse(BaseModel):
    phone: str
    expires_at: datetime
    is_used: bool

    class Config:
        from_attributes = True
