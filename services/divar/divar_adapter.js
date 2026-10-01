const DIVAR_BASE = "https://divar.ir/s";

const CITY_MAP = {
  tehran: "tehran",
  تهران: "tehran",
  shiraz: "shiraz",
  شیراز: "shiraz",
  isfahan: "isfahan",
  اصفهان: "isfahan",
  gorgan: "gorgan",
  گرگان: "gorgan",
  mashhad: "mashhad",
  مشهد: "mashhad",
  tabriz: "tabriz",
  تبریز: "tabriz",
  ahvaz: "ahvaz",
  اهواز: "ahvaz",
  rasht: "rasht",
  رشت: "rasht",
  kish: "kish",
  کیش: "kish",
  arak: "arak",
  اراک: "arak",
  kerman: "kerman",
  کرمان: "kerman",
  "bandar Abbas": "bandar-abbas",
  بندرعباس: "bandar-abbas",
  yazd: "yazd",
  یزد: "yazd",
  zahedan: "zahedan",
  زاهدان: "zahedan",
  uromia: "urumieh",
  ارومیه: "urumieh",
  hamadan: "hamadan",
  همدان: "hamadan",
  khorramabad: "khorramabad",
  خرم‌آباد: "khorramabad",
  birjand: "birjand",
  بیرجند: "birjand",
  bojnurd: "bojnurd",
  بجنورد: "bojnurd",
  sarieh: "sari",
  ساری: "sari",
  babol: "babol",
  بابل: "babol",
  qom: "qom",
  قم: "qom",
  karaj: "karaj",
  کرج: "karaj",
};

const CATEGORY_MAP = {
  "buy-apartment": "buy-apartment",
  "rent-apartment": "rent-apartment",
  "buy-villa": "buy-villa",
  "rent-villa": "rent-villa",
  "buy-residential": "buy-residential",
  "rent-residential": "rent-residential",
  "buy-commercial-property": "buy-commercial-property",
  "rent-commercial-property": "rent-commercial-property",
  "buy-office": "buy-office",
  "rent-office": "rent-office",
  "buy-store": "buy-store",
  "rent-store": "rent-store",
};

const QUERY_ALIASES = {
  ویلاهشر: "ویلاشهر",
  ویلاشهر: "ویلاشهر",
};

/**
 * Build Divar search URL from structured search object.
 * City and category go in the URL path. Filters go as query params.
 *
 * @param {Object} search - Structured search from search_parser
 * @returns {Object} { url, postFilters }
 *   url: string — Divar search URL with all supported query params
 *   postFilters: Object — filters to apply in JS after scraping (for extra precision)
 */
function buildDivarRequest(search) {
  const city = CITY_MAP[search.city] || search.city || "gorgan";
  const category = CATEGORY_MAP[search.category] || "buy-residential";

  const params = new URLSearchParams();

  // Normalize common Persian typing variations before sending the query.
  if (search.query) {
    params.set(
      "query",
      QUERY_ALIASES[search.query.trim()] || search.query.trim(),
    );
  }

  // Property type
  if (search.type) params.set("type", search.type);

  // Keep the Divar request broad. Its filter query parameters can produce an
  // empty page even when matching listings exist; precise filtering happens below.

  const qs = params.toString();
  const url = `${DIVAR_BASE}/${city}/${category}${qs ? "?" + qs : ""}`;

  // Post-filters: apply in JS after scraping for extra precision
  // (Divar may return slightly off results for some param combinations)
  // in here we pass what filter we want to apply on divar.
  const postFilters = {};
  if (search.type) {
    postFilters.type = search.type;
    postFilters.type_verified_by_source = true;
  }
  if (search.rooms != null) postFilters.rooms = String(search.rooms);
  if (search.size_min != null) postFilters.size_min = search.size_min;
  if (search.size_max != null) postFilters.size_max = search.size_max;
  if (search.price_min != null) postFilters.price_min = search.price_min;
  if (search.price_max != null) postFilters.price_max = search.price_max;
  if (search.rent_min != null) postFilters.rent_min = search.rent_min;
  if (search.rent_max != null) postFilters.rent_max = search.rent_max;
  if (search.credit_min != null) postFilters.credit_min = search.credit_min;
  if (search.credit_max != null) postFilters.credit_max = search.credit_max;
  if (search.elevator === true) postFilters.elevator = true;
  if (search.parking === true) postFilters.parking = true;
  if (search.warehouse === true) postFilters.warehouse = true;
  if (search.balcony === true) postFilters.balcony = true;

  return { url, postFilters };
}

/**
 * Apply post-filters to scraped ads for extra precision.
 * When a user specifies a filter, ads missing that data are REJECTED.
 */
function applyPostFilters(
  ads,
  filters,
  { scoreBoundsOnly = false, maxBudgetOverrunFraction = 0.25 } = {},
) {
  if (!filters || Object.keys(filters).length === 0) return ads;

  const activeFilters = scoreBoundsOnly
    ? Object.fromEntries(
        Object.entries(filters).filter(
          ([key]) =>
            !["size_min", "size_max", "price_min", "price_max"].includes(key),
        ),
      )
    : filters;

  return ads
    .filter((ad) => {
      if (
        scoreBoundsOnly &&
        filters.price_max != null &&
        ad.price != null &&
        Number.isFinite(Number(filters.price_max)) &&
        Number.isFinite(Number(ad.price)) &&
        Number(ad.price) >
          Number(filters.price_max) * (1 + maxBudgetOverrunFraction)
      ) {
        return false;
      }

      // Type filter — if ad has type data, check it. If null, keep (Divar URL filtered).
      if (activeFilters.type && ad.type !== null && ad.type !== undefined) {
        if (ad.type !== activeFilters.type) return false;
      }

      // Rooms filter — if ad has rooms data, check it
      if (
        activeFilters.rooms != null &&
        ad.rooms !== null &&
        ad.rooms !== undefined
      ) {
        if (String(ad.rooms) !== String(activeFilters.rooms)) return false;
      }

      // Area min — if ad has area, check it. If null, keep.
      if (
        activeFilters.size_min != null &&
        ad.area !== null &&
        ad.area !== undefined
      ) {
        if (ad.area < activeFilters.size_min) return false;
      }

      // Area max — if ad has area, check it. If null, keep.
      if (
        activeFilters.size_max != null &&
        ad.area !== null &&
        ad.area !== undefined
      ) {
        if (ad.area > activeFilters.size_max) return false;
      }

      // Price range — if ad has price, check it
      if (
        activeFilters.price_min != null &&
        ad.price !== null &&
        ad.price !== undefined
      ) {
        if (ad.price < activeFilters.price_min) return false;
      }
      if (
        activeFilters.price_max != null &&
        ad.price !== null &&
        ad.price !== undefined
      ) {
        if (ad.price > activeFilters.price_max) return false;
      }

      // Rent range — if ad has rent, check it
      if (
        activeFilters.rent_min != null &&
        ad.rent !== null &&
        ad.rent !== undefined
      ) {
        if (ad.rent < activeFilters.rent_min) return false;
      }
      if (
        activeFilters.rent_max != null &&
        ad.rent !== null &&
        ad.rent !== undefined
      ) {
        if (ad.rent > activeFilters.rent_max) return false;
      }

      // Credit/رهن range — if ad has credit, check it
      if (
        activeFilters.credit_min != null &&
        ad.credit !== null &&
        ad.credit !== undefined
      ) {
        if (ad.credit < activeFilters.credit_min) return false;
      }
      if (
        activeFilters.credit_max != null &&
        ad.credit !== null &&
        ad.credit !== undefined
      ) {
        if (ad.credit > activeFilters.credit_max) return false;
      }

      // Amenities — reject if user wants it but ad explicitly says no
      if (activeFilters.elevator === true && ad.elevator === false)
        return false;
      if (activeFilters.parking === true && ad.parking === false) return false;
      if (activeFilters.warehouse === true && ad.warehouse === false)
        return false;
      if (activeFilters.balcony === true && ad.balcony === false) return false;

      return true;
    })
    .map((ad) => {
      const unknown = [];
      if (
        activeFilters.type &&
        !activeFilters.type_verified_by_source &&
        ad.type == null
      )
        unknown.push("نوع ملک");
      if (activeFilters.rooms != null && ad.rooms == null)
        unknown.push("تعداد خواب");
      if (
        (activeFilters.size_min != null || activeFilters.size_max != null) &&
        ad.area == null
      )
        unknown.push("متراژ");
      if (
        (activeFilters.price_min != null || activeFilters.price_max != null) &&
        ad.price == null
      )
        unknown.push("قیمت");
      if (
        (activeFilters.rent_min != null || activeFilters.rent_max != null) &&
        ad.rent == null
      )
        unknown.push("اجاره");
      if (
        (activeFilters.credit_min != null ||
          activeFilters.credit_max != null) &&
        ad.credit == null
      )
        unknown.push("رهن");
      if (activeFilters.elevator === true && ad.elevator == null)
        unknown.push("آسانسور");
      if (activeFilters.parking === true && ad.parking == null)
        unknown.push("پارکینگ");
      if (activeFilters.warehouse === true && ad.warehouse == null)
        unknown.push("انباری");
      if (activeFilters.balcony === true && ad.balcony == null)
        unknown.push("بالکن");

      return {
        ...ad,
        verification: unknown.length
          ? "نیازمند بررسی"
          : "تطبیق کامل با فیلترها",
        unknown_filters: unknown,
      };
    });
}

export { buildDivarRequest, applyPostFilters, CITY_MAP, CATEGORY_MAP };
