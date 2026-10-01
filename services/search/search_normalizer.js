import { CATEGORY_MAP } from "../divar/divar_adapter.js";

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

const DEAL_PREFIX = {
    sale: "buy",
    rent: "rent",
};

const TYPE_ALIASES = {
    apartment: "apartment",
    آپارتمان: "apartment",
    villa: "villa",
    ویلا: "villa",
    ویلایی: "villa",
    house: "house",
    خانه: "house",
    "خانه ویلایی": "house",
    land: "land",
    زمین: "land",
    office: "office",
    اداری: "office",
    store: "store",
    مغازه: "store",
    فروشگاه: "store",
    commercial: "commercial",
    تجاری: "commercial",
};

const TYPE_CATEGORY_SUFFIX = {
    apartment: "apartment",
    villa: "villa",
    house: "residential",
    land: "residential",
    office: "office",
    store: "store",
    commercial: "commercial-property",
};

const PRICE_KEYS = ["price", "cost", "budget", "قیمت", "بودجه"];
const PRICE_MIN_KEYS = ["price_min", "min_price", "حداقل قیمت"];
const PRICE_MAX_KEYS = ["price_max", "max_price", "حداکثر قیمت"];

const RENT_KEYS = ["rent", "monthly_rent", "اجاره", "اجاره ماهانه"];
const RENT_MIN_KEYS = ["rent_min", "min_rent", "حداقل اجاره"];
const RENT_MAX_KEYS = ["rent_max", "max_rent", "حداکثر اجاره"];

const CREDIT_KEYS = ["credit", "deposit", "رهن", "ودیعه"];
const CREDIT_MIN_KEYS = ["credit_min", "min_credit", "حداقل رهن"];
const CREDIT_MAX_KEYS = ["credit_max", "max_credit", "حداکثر رهن"];

const SIZE_KEYS = ["size", "area", "metraj", "متراژ", "size_m2"];
const SIZE_MIN_KEYS = ["size_min", "area_min", "حداقل متراژ"];
const SIZE_MAX_KEYS = ["size_max", "area_max", "حداکثر متراژ"];

const TRUE_WORDS = new Set([
    "true",
    "1",
    "yes",
    "y",
    "on",
    "required",
    "بله",
    "خير",
    "خیر",
    "دارد",
    "هست",
    "می‌خواهم",
    "ميخوام",
    "میخوام",
]);

const FALSE_WORDS = new Set([
    "false",
    "0",
    "no",
    "n",
    "off",
    "ندارد",
    "نیست",
    "نميخوام",
    "نمی‌خواهم",
    "نميخوام",
]);

const SALE_WORDS = new Set([
    "sale",
    "sell",
    "buy",
    "purchase",
    "فروش",
    "خرید",
    "خريد",
    "فروشی",
    "فروشي",
    "fs",
]);

const RENT_WORDS = new Set([
    "rent",
    "rental",
    "اجاره",
    "اجاره‌ای",
    "اجاره اي",
    "رهن",
    "کرایه",
    "كرایه",
    "leasing",
]);

const RANGE_SEPARATOR = /\s*(?:تا|الی)\s*|\s+to\s+|\s*[-–—]\s*/i;

function envNumber(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function toENDigits(value) {
    return String(value).replace(/[۰-۹]/g, (digit) =>
        String(PERSIAN_DIGITS.indexOf(digit)),
    );
}

function pickFirst(input, keys) {
    for (const key of keys) {
        const value = input[key];
        if (value !== undefined && value !== null && value !== "") return value;
    }
    return null;
}

function detectMultiplier(text) {
    if (/میلیارد|billion/.test(text)) return 1e9;
    if (/میلیون|million/.test(text)) return 1e6;
    if (/هزار|thousand/.test(text)) return 1e3;
    return 1;
}

function hasMoneyUnit(text) {
    return /میلیارد|میلیون|هزار|billion|million|thousand/.test(text);
}

function parseNumeric(value, { money = false } = {}) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;

    let text = toENDigits(value).toLowerCase().trim();
    if (!text) return null;

    const multiplier = money ? detectMultiplier(text) : 1;

    text = text.replace(/(\d),(?=\d)/g, "$1");
    const numbers = text.match(/\d+(?:\.\d+)?/);
    if (!numbers) return null;

    return Number(numbers[0]) * multiplier;
}

function parseScalar(value, opts) {
    if (value === null || value === undefined || value === "") return null;

    if (Array.isArray(value)) {
        if (value.length === 0) return null;
        if (value.length === 1) return parseScalar(value[0], opts);

        const lo = parseNumeric(value[0], opts);
        const hi = parseNumeric(value[1], opts);
        if (lo === null || hi === null) return null;
        return { range: true, min: Math.min(lo, hi), max: Math.max(lo, hi) };
    }

    if (typeof value === "object") {
        const lo = parseNumeric(value.min ?? value.min_value, opts);
        const hi = parseNumeric(value.max ?? value.max_value, opts);
        if (lo === null && hi === null) return null;
        return { range: true, min: lo, max: hi };
    }

    if (typeof value === "string") {
        const raw = toENDigits(value);
        const parts = raw.split(RANGE_SEPARATOR);
        if (parts.length === 2) {
            // "3 تا 4 میلیارد" — unit applies to both sides of the range.
            const baseLo = parseNumeric(parts[0], { money: false });
            const baseHi = parseNumeric(parts[1], { money: false });
            if (baseLo !== null && baseHi !== null) {
                const fullMultiplier = opts.money ? detectMultiplier(raw) : 1;
                const lo =
                    baseLo *
                    (opts.money && hasMoneyUnit(parts[0])
                        ? detectMultiplier(parts[0])
                        : fullMultiplier);
                const hi =
                    baseHi *
                    (opts.money && hasMoneyUnit(parts[1])
                        ? detectMultiplier(parts[1])
                        : fullMultiplier);
                return {
                    range: true,
                    min: Math.min(lo, hi),
                    max: Math.max(lo, hi),
                };
            }
        }
    }

    const single = parseNumeric(value, opts);
    if (single === null) return null;
    return { range: false, value: single };
}

function moneyStep(value) {
    if (value >= 1e9) return 1e8;
    if (value >= 1e8) return 1e7;
    if (value >= 1e7) return 1e6;
    return 1e5;
}

function expandRange(value, { percent = 0, absolute = 0, money = false }) {
    const delta = Math.max((value * percent) / 100, absolute);
    let min = value - delta;
    let max = value + delta;

    if (money) {
        const step = moneyStep(Math.max(Math.abs(value), 1));
        min = Math.floor(min / step) * step;
        max = Math.ceil(max / step) * step;
    } else {
        min = Math.round(min);
        max = Math.round(max);
    }

    if (min < 0) min = 0;
    return { min, max };
}

function buildRange(
    input,
    { keys, minKeys, maxKeys, percent, absolute, money },
) {
    const opts = { money };
    const explicitMin = parseNumeric(pickFirst(input, minKeys), opts);
    const explicitMax = parseNumeric(pickFirst(input, maxKeys), opts);

    if (explicitMin !== null || explicitMax !== null) {
        if (
            explicitMin !== null &&
            explicitMax !== null &&
            explicitMin > explicitMax
        ) {
            return { min: explicitMax, max: explicitMin };
        }
        return { min: explicitMin, max: explicitMax };
    }

    const scalar = parseScalar(pickFirst(input, keys), opts);
    if (!scalar) return { min: null, max: null };
    if (scalar.range) return { min: scalar.min, max: scalar.max };

    return expandRange(scalar.value, { percent, absolute, money });
}

function toBool(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;

    const text = toENDigits(String(value).trim().toLowerCase());
    if (TRUE_WORDS.has(text)) return true;
    if (FALSE_WORDS.has(text)) return false;
    return null;
}

function pickBool(input, keys) {
    for (const key of keys) {
        const value = input[key];
        if (value !== undefined && value !== null && value !== "") {
            return toBool(value);
        }
    }
    return null;
}

function normalizeDealWord(value) {
    if (value === null || value === undefined || value === "") return null;
    const text = toENDigits(String(value).trim().toLowerCase());
    if (SALE_WORDS.has(text)) return "sale";
    if (RENT_WORDS.has(text)) return "rent";
    return null;
}

function resolveDeal(input) {
    const explicit = normalizeDealWord(
        pickFirst(input, [
            "deal",
            "deal_type",
            "transaction_type",
            "transactionType",
            "listing_type",
            "status",
            "mode",
        ]),
    );
    if (explicit) return explicit;

    const hasRentField =
        pickFirst(input, [
            "rent",
            "rent_min",
            "rent_max",
            "credit",
            "credit_min",
            "credit_max",
            "deposit",
            "اجاره",
            "رهن",
        ]) !== null;
    if (hasRentField) return "rent";

    const freeText = [input.query, input.text, input.search, input.neighborhood]
        .filter(Boolean)
        .join(" ");

    if (freeText) {
        if (/اجاره|رهن|ودیعه|اجاره‌ای/i.test(freeText)) return "rent";
        if (/فروش|خرید|برای فروش/i.test(freeText)) return "sale";
    }

    const category = input.category ? String(input.category) : "";
    if (category.startsWith("rent-")) return "rent";
    if (category.startsWith("buy-")) return "sale";

    return "sale";
}

function resolveType(value) {
    if (value === null || value === undefined || value === "") return null;
    const raw = String(value).trim();
    const lower = raw.toLowerCase();

    return TYPE_ALIASES[lower] ?? TYPE_ALIASES[raw] ?? null;
}

function resolveCategory(input, deal, type) {
    const prefix = DEAL_PREFIX[deal] || "buy";

    const explicit = input.category ? CATEGORY_MAP[input.category] : null;
    const suffix = explicit
        ? explicit.replace(/^(buy|rent)-/, "")
        : TYPE_CATEGORY_SUFFIX[type] || "apartment";

    const category = `${prefix}-${suffix}`;
    return CATEGORY_MAP[category] ? category : `${prefix}-apartment`;
}

/**
 * Turn simple user input into the full structured search used by the pipeline.
 *
 * The user only has to provide:
 *   - deal: "sale" | "rent"            → Divar category is derived automatically
 *   - price (single number)            → min/max computed with tolerance
 *   - size/area (single number)        → min/max computed with tolerance
 *   - elevator / parking / warehouse   → amenity flags
 *
 * Explicit min/max values are always respected as-is.
 */
export function normalizeSearchInput(input = {}) {
    const pricePercent = envNumber("PRICE_TOLERANCE_PERCENT", 10);
    const rentPercent = envNumber("RENT_TOLERANCE_PERCENT", 20);
    const creditPercent = envNumber("CREDIT_TOLERANCE_PERCENT", 20);
    const areaTolerance = envNumber("AREA_TOLERANCE_M2", 10);

    const deal = resolveDeal(input);
    const type = resolveType(input.type);
    const category = resolveCategory(input, deal, type);

    // For rentals the generic "price" fields mean the monthly rent.
    const isRent = deal === "rent";

    const price = isRent
        ? { min: null, max: null }
        : buildRange(input, {
              keys: PRICE_KEYS,
              minKeys: PRICE_MIN_KEYS,
              maxKeys: PRICE_MAX_KEYS,
              percent: pricePercent,
              money: true,
          });

    const rent = buildRange(input, {
        keys: isRent ? [...RENT_KEYS, ...PRICE_KEYS] : RENT_KEYS,
        minKeys: isRent ? [...RENT_MIN_KEYS, ...PRICE_MIN_KEYS] : RENT_MIN_KEYS,
        maxKeys: isRent ? [...RENT_MAX_KEYS, ...PRICE_MAX_KEYS] : RENT_MAX_KEYS,
        percent: rentPercent,
        money: true,
    });

    const credit = buildRange(input, {
        keys: CREDIT_KEYS,
        minKeys: CREDIT_MIN_KEYS,
        maxKeys: CREDIT_MAX_KEYS,
        percent: creditPercent,
        money: true,
    });

    const size = buildRange(input, {
        keys: SIZE_KEYS,
        minKeys: SIZE_MIN_KEYS,
        maxKeys: SIZE_MAX_KEYS,
        absolute: areaTolerance,
        money: false,
    });

    const roomsRaw = pickFirst(input, ["rooms", "room", "bedrooms", "خواب"]);
    const roomsParsed = parseNumeric(roomsRaw);

    return {
        city: input.city || "gorgan",
        deal,
        category,
        type,
        rooms: roomsRaw === null ? null : (roomsParsed ?? String(roomsRaw)),
        size_min: size.min,
        size_max: size.max,
        price_min: price.min,
        price_max: price.max,
        building_age_min: parseNumeric(
            pickFirst(input, ["building_age_min", "min_building_age"]),
        ),
        building_age_max: parseNumeric(
            pickFirst(input, ["building_age_max", "max_building_age"]),
        ),
        match_weights: input.match_weights ?? input.matchWeights ?? null,
        rent_min: rent.min,
        rent_max: rent.max,
        credit_min: credit.min,
        credit_max: credit.max,
        elevator: pickBool(input, ["elevator", "has_elevator"]),
        parking: pickBool(input, ["parking", "has_parking"]),
        warehouse: pickBool(input, [
            "warehouse",
            "storage",
            "has_warehouse",
            "has_storage",
            "انباری",
        ]),
        balcony: pickBool(input, ["balcony", "has_balcony", "بالکن"]),
        query: input.query || null,
    };
}

export { parseNumeric, toBool, expandRange };
