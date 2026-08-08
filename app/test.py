import http.client
import json
import os
from dotenv import load_dotenv

HOST = "open-api.divar.ir"
PATH = "/v2/open-platform/finder/post"

load_dotenv()

API_KEY = os.getenv("DIVAR_API_KEY")

REQUIREMENTS = {
    "category": "apartment-sell",
    "city": "tehran",

    "min_price": 10_000_000_000,
    "max_price": 15_000_000_000,

    "min_size": 60,
    "max_size": 80,

    "min_year": 1400,

    "has_parking": False,
    "has_elevator": True,

    "min_rooms": 1,
}


def room_names(min_rooms):
    rooms = ["یک", "دو", "سه", "چهار", "پنج"]
    return rooms[min_rooms - 1:]


def build_query(r):
    return {
        "credit": {
            "min": r["min_price"],
            "max": r["max_price"],
        },
        "size": {
            "min": r["min_size"],
            "max": r["max_size"],
        },
        "production_year": {
            "min": r["min_year"],
        },
        "rooms": room_names(r["min_rooms"]),
    }


def matches(post, requirements):
    fields = post.get("real_estate_fields", {})

    # Elevator
    if requirements["has_elevator"]:
        if fields.get("has_elevator") is not True:
            return False

    # Parking
    if requirements["has_parking"]:
        if fields.get("has_parking") is not True:
            return False

    # Year
    year = fields.get("year", 0)

    if year < requirements["min_year"]:
        return False

    return True


if not API_KEY:
    raise RuntimeError("DIVAR_API_KEY is not set")


payload = {
    "category": REQUIREMENTS["category"],
    "city": REQUIREMENTS["city"],
    "districts": [],
    "query": build_query(REQUIREMENTS),
}

headers = {
    "Content-Type": "application/json",
    "x-api-key": API_KEY,
}


conn = http.client.HTTPSConnection(HOST)

try:
    conn.request(
        "POST",
        PATH,
        body=json.dumps(payload),
        headers=headers,
    )

    response = conn.getresponse()
    data = json.loads(response.read().decode())

finally:
    conn.close()


if response.status != 200:
    print("API ERROR:", response.status)
    print(json.dumps(data, indent=2, ensure_ascii=False))
    exit(1)


posts = data.get("posts", [])

matched_posts = [
    post for post in posts
    if matches(post, REQUIREMENTS)
]


print("\n" + "=" * 60)
print("REQUEST")
print("=" * 60)

print(json.dumps(payload, indent=2, ensure_ascii=False))


print("\n" + "=" * 60)
print(f"DIVAR ADS: {len(posts)}")
print(f"MATCHED ADS: {len(matched_posts)}")
print("=" * 60)


for i, post in enumerate(matched_posts, 1):
    fields = post.get("real_estate_fields", {})
    token = post.get("token")

    print("\n" + "-" * 60)
    print(f"#{i}")

    print("Title:", post.get("title"))
    print("Price:", post.get("price", {}).get("value"))
    print("Size:", fields.get("size"))
    print("Year:", fields.get("year"))
    print("Rooms:", fields.get("rooms"))
    print("Parking:", fields.get("has_parking"))
    print("Elevator:", fields.get("has_elevator"))
    print("URL:", f"https://divar.ir/v/{token}")
