from dotenv import load_dotenv
import httpx
import os

load_dotenv()

KAVENEGAR_API_KEY = os.getenv("KAVENEGAR_API_KEY")


async def send_sms(phone: str, code: str):
    # Ensure there are no hidden spaces or formatting issues in the URL
    url = f"https://api.kavenegar.com/v1/{KAVENEGAR_API_KEY}/verify/lookup.json"

    payload = {"receptor": phone, "token": code, "template": "verify"}

    async with httpx.AsyncClient() as client:
        # Use data= for form-encoding
        response = await client.post(url, data=payload)

        # Log the status for debugging
        print(f"Status: {response.status_code}, Body: {response.text}")

    return response.json()


async def send_otp(phone: str, code: str):
    """Backward-compatible name used by routers/auth.py."""
    return await send_sms(phone, code)
