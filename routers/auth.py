from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from schemas.auth import SendOTPRequest, VerifyOTPRequest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import AsyncSessionLocal
from core.security import create_access_token
from models.user import User
from models.otp import OTPCode, OTPVerification
from services.otp_service import generate_otp
from services.sms_service import send_otp

router = APIRouter(prefix="/auth")


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


@router.post("/send-otp")
async def send_otp_route(data: SendOTPRequest, db: AsyncSession = Depends(get_db)):

    code = generate_otp()

    otp = OTPCode(
        phone=data.phone, code=code, expires_at=datetime.utcnow() + timedelta(minutes=2)
    )

    db.add(otp)

    await db.commit()

    await send_otp(data.phone, code)

    return {"message": "OTP sent"}


@router.post("/verify-otp")
async def verify_otp(data: OTPVerification, db: AsyncSession = Depends(get_db)):

    result = await db.execute(
        select(OTPCode).where(
            OTPCode.phone == data.phone,
            OTPCode.code == data.code,
            OTPCode.is_used == False,
        )
    )

    otp = result.scalar_one_or_none()

    if not otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")

    # if otp.expires_at < datetime.utcnow():
    #     raise HTTPException(status_code=400, detail="OTP expired")

    otp.is_used = True

    result = await db.execute(select(User).where(User.phone == data.phone))

    user = result.scalar_one_or_none()

    if not user:

        user = User(phone=data.phone)

        db.add(user)

        await db.commit()

        await db.refresh(user)

    # create JWT with subject set to user id
    token = create_access_token(subject=str(user.id))

    await db.commit()

    # return standard OAuth2 token response
    return {"access_token": token, "token_type": "bearer", "user_id": str(user.id)}
