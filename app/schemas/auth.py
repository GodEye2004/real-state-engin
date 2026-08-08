from pydantic import BaseModel


class SendOTPRequest(BaseModel):
    phone: str


class VerifyOTPRequest(BaseModel):
    phone: str
    code: str
