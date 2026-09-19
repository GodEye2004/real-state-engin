const OpenAI = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.CHAT_MODEL || "gpt-4o-mini";

const SYSTEM_PROMPT = `
You are a search query parser for Divar.ir (Iranian real-estate platform).
Given a user prompt in Persian (or mixed), extract a structured search object.

Return ONLY valid JSON with these fields (use null for anything not mentioned):
{
  "city": "string — city name in English lowercase. Default: gorgan",
  "category": "string — one of: buy-apartment, rent-apartment, buy-villa, rent-villa, buy-residential, rent-residential, buy-commercial-property, rent-commercial-property, buy-office, rent-office, buy-store, rent-store. Default: buy-residential",
  "type": "string — one of: apartment, villa, house, land, office, store. null if not specified",
  "rooms": "string — number of bedrooms as string: '0','1','2','3','4','5'. null if not mentioned",
  "size_min": "number — minimum area in square meters. null if not mentioned",
  "size_max": "number — maximum area in square meters. null if not mentioned",
  "price_min": "number — minimum price in Tomans (full number). null if not mentioned",
  "price_max": "number — maximum price in Tomans (full number). null if not mentioned",
  "rent_min": "number — minimum monthly rent in Tomans (for rental). null if not mentioned",
  "rent_max": "number — maximum monthly rent in Tomans (for rental). null if not mentioned",
  "credit_min": "number — minimum deposit/رهن in Tomans. null if not mentioned",
  "credit_max": "number — maximum deposit/رهن in Tomans. null if not mentioned",
  "elevator": "boolean — true if user wants elevator, null if not mentioned",
  "parking": "boolean — true if user wants parking, null if not mentioned",
  "warehouse": "boolean — true if user wants storage room, null if not mentioned",
  "balcony": "boolean — true if user wants balcony, null if not mentioned",
  "floor_min": "number — minimum floor. null if not mentioned",
  "floor_max": "number — maximum floor. null if not mentioned",
  "floors_count_min": "number — min total floors in building. null if not mentioned",
  "floors_count_max": "number — max total floors in building. null if not mentioned",
  "building_age_max": "number — max building age in years. null if not mentioned",
  "has_photo": "boolean — true if user wants only listings with photos",
  "has_video": "boolean — true if user wants only listings with video",
  "query": "string — 1-4 word Persian text for Divar search box (property type + area name). null if not useful"
}

CRITICAL RULES for area (metre):
- When user says a SPECIFIC size like "۱۲۰ متری" or "۱۲۰ متر", ALWAYS create a TOLERANCE RANGE: size_min = X - 10, size_max = X + 10. Example: "۱۲۰ متری" means size_min: 110, size_max: 130
- When user says a RANGE like "۱۲۰ تا ۱۵۰ متر", use exactly: size_min: 120, size_max: 150
- When user says "زیر ۱۰۰ متر" (under X), use: size_max: X, size_min: null
- When user says "بالای ۱۵۰ متر" (above X), use: size_min: X, size_max: null
- NEVER set only size_min without size_max for an exact number. ALWAYS create ±10 range for exact numbers.

Conversion rules:
- "میلیارد" = 1,000,000,000 Tomans
- "میلیون" = 1,000,000 Tomans
- "تومن" = Tomans (same unit)
- "رهن" → credit_min/credit_max
- "اجاره" → rent_min/rent_max
- Persian numbers (۰۱۲۳۴۵۶۷۸۹) must be converted to English digits
- "دو خواب" / "۲ خواب" → rooms: "2"
- "آپارتمان" → type: "apartment", category: "buy-apartment"
- "ویلا" / "ویلایی" → type: "villa", category: "buy-villa"
- "خانه" / "خانه ویلایی" → type: "house"
- "اجاره‌ای" / "اجاره" → adjust category to rent variant
- "فروش" → adjust category to buy variant
- "آسانسور" → elevator: true
- "پارکینگ" → parking: true
- "انباری" → warehouse: true
- "بالکن" → balcony: true
- "طبقه اول" → floor_min: 1, floor_max: 1
- "زیر ۵ طبقه" → floors_count_max: 5
- "نوساز" / "نو" → building_age_max: 2
- "کلنگی" / "کهنه" → building_age_min: 15 (old building)

Examples:
User: "آپارتمان ۱۲۰ تا ۱۵۰ متر دو خواب گرگان تا ۵ میلیارد آسانسور پارکینگ"
Output: {"city":"gorgan","category":"buy-apartment","type":"apartment","rooms":"2","size_min":120,"size_max":150,"price_min":null,"price_max":5000000000,"rent_min":null,"rent_max":null,"credit_min":null,"credit_max":null,"elevator":true,"parking":true,"warehouse":null,"balcony":null,"floor_min":null,"floor_max":null,"floors_count_min":null,"floors_count_max":null,"building_age_max":null,"has_photo":null,"has_video":null,"query":"آپارتمان گرگان"}

User: "ویلا ۳ خوابه شمال زیر ۲ میلیارد نوساز"
Output: {"city":"gorgan","category":"buy-villa","type":"villa","rooms":"3","size_min":null,"size_max":null,"price_min":null,"price_max":2000000000,"rent_min":null,"rent_max":null,"credit_min":null,"credit_max":null,"elevator":null,"parking":null,"warehouse":null,"balcony":null,"floor_min":null,"floor_max":null,"floors_count_min":null,"floors_count_max":null,"building_age_max":2,"has_photo":null,"has_video":null,"query":"ویلا شمال"}

User: "آپارتمان اجاره‌ای تهران ۱ خوابه تا ۵ میلیون اجاره رهن ۲۰۰ میلیون"
Output: {"city":"tehran","category":"rent-apartment","type":"apartment","rooms":"1","size_min":null,"size_max":null,"price_min":null,"price_max":null,"rent_min":null,"rent_max":5000000,"credit_min":null,"credit_max":200000000,"elevator":null,"parking":null,"warehouse":null,"balcony":null,"floor_min":null,"floor_max":null,"floors_count_min":null,"floors_count_max":null,"building_age_max":null,"has_photo":null,"has_video":null,"query":"آپارتمان اجاره تهران"}

User: "خانه ویلایی ۲۰۰ متری گرگان با پارکینگ و انباری"
Output: {"city":"gorgan","category":"buy-residential","type":"house","rooms":null,"size_min":190,"size_max":210,"price_min":null,"price_max":null,"rent_min":null,"rent_max":null,"credit_min":null,"credit_max":null,"elevator":null,"parking":true,"warehouse":true,"balcony":null,"floor_min":null,"floor_max":null,"floors_count_min":null,"floors_count_max":null,"building_age_max":null,"has_photo":null,"has_video":null,"query":"خانه ویلایی گرگان"}

User: "آپارتمان ۱۲۰ متری جانبازان گرگان"
Output: {"city":"gorgan","category":"buy-apartment","type":"apartment","rooms":null,"size_min":110,"size_max":130,"price_min":null,"price_max":null,"rent_min":null,"rent_max":null,"credit_min":null,"credit_max":null,"elevator":null,"parking":null,"warehouse":null,"balcony":null,"floor_min":null,"floor_max":null,"floors_count_min":null,"floors_count_max":null,"building_age_max":null,"has_photo":null,"has_video":null,"query":"آپارتمان جانبازان گرگان"}
`;

async function parseSearchPrompt(userPrompt) {
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_tokens: 500,
    temperature: 0.1,
  });

  const parsed = JSON.parse(completion.choices[0].message.content);

  return {
    city: parsed.city || "gorgan",
    category: parsed.category || "buy-residential",
    type: parsed.type || null,
    rooms: parsed.rooms || null,
    size_min: parsed.size_min || null,
    size_max: parsed.size_max || null,
    price_min: parsed.price_min || null,
    price_max: parsed.price_max || null,
    rent_min: parsed.rent_min || null,
    rent_max: parsed.rent_max || null,
    credit_min: parsed.credit_min || null,
    credit_max: parsed.credit_max || null,
    elevator: parsed.elevator ?? null,
    parking: parsed.parking ?? null,
    warehouse: parsed.warehouse ?? null,
    balcony: parsed.balcony ?? null,
    floor_min: parsed.floor_min || null,
    floor_max: parsed.floor_max || null,
    floors_count_min: parsed.floors_count_min || null,
    floors_count_max: parsed.floors_count_max || null,
    building_age_max: parsed.building_age_max || null,
    has_photo: parsed.has_photo ?? null,
    has_video: parsed.has_video ?? null,
    query: parsed.query || null,
  };
}

module.exports = { parseSearchPrompt };
