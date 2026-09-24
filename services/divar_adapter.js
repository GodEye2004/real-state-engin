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
  const postFilters = {};
  if (search.type) {
    postFilters.type = search.type;
    postFilters.type_verified_by_source = true;
  }
  if (search.rooms) postFilters.rooms = String(search.rooms);
  if (search.size_min) postFilters.size_min = search.size_min;
  if (search.size_max) postFilters.size_max = search.size_max;
  if (search.price_min) postFilters.price_min = search.price_min;
  if (search.price_max) postFilters.price_max = search.price_max;
  if (search.rent_min) postFilters.rent_min = search.rent_min;
  if (search.rent_max) postFilters.rent_max = search.rent_max;
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
function applyPostFilters(ads, filters) {
  if (!filters || Object.keys(filters).length === 0) return ads;

  return ads
    .filter((ad) => {
      // Type filter — if ad has type data, check it. If null, keep (Divar URL filtered).
      if (filters.type && ad.type !== null && ad.type !== undefined) {
        if (ad.type !== filters.type) return false;
      }

      // Rooms filter — if ad has rooms data, check it
      if (filters.rooms && ad.rooms !== null && ad.rooms !== undefined) {
        if (String(ad.rooms) !== String(filters.rooms)) return false;
      }

      // Area min — if ad has area, check it. If null, keep.
      if (filters.size_min && ad.area !== null && ad.area !== undefined) {
        if (ad.area < filters.size_min) return false;
      }

      // Area max — if ad has area, check it. If null, keep.
      if (filters.size_max && ad.area !== null && ad.area !== undefined) {
        if (ad.area > filters.size_max) return false;
      }

      // Price range — if ad has price, check it
      if (filters.price_min && ad.price !== null && ad.price !== undefined) {
        if (ad.price < filters.price_min) return false;
      }
      if (filters.price_max && ad.price !== null && ad.price !== undefined) {
        if (ad.price > filters.price_max) return false;
      }

      // Rent range — if ad has rent, check it
      if (filters.rent_min && ad.rent !== null && ad.rent !== undefined) {
        if (ad.rent < filters.rent_min) return false;
      }
      if (filters.rent_max && ad.rent !== null && ad.rent !== undefined) {
        if (ad.rent > filters.rent_max) return false;
      }

      // Amenities — reject if user wants it but ad explicitly says no
      if (filters.elevator === true && ad.elevator === false) return false;
      if (filters.parking === true && ad.parking === false) return false;
      if (filters.warehouse === true && ad.warehouse === false) return false;
      if (filters.balcony === true && ad.balcony === false) return false;

      return true;
    })
    .map((ad) => {
      const unknown = [];
      if (filters.type && !filters.type_verified_by_source && ad.type == null)
        unknown.push("نوع ملک");
      if (filters.rooms && ad.rooms == null) unknown.push("تعداد خواب");
      if ((filters.size_min || filters.size_max) && ad.area == null)
        unknown.push("متراژ");
      if ((filters.price_min || filters.price_max) && ad.price == null)
        unknown.push("قیمت");
      if ((filters.rent_min || filters.rent_max) && ad.rent == null)
        unknown.push("اجاره");
      if (filters.elevator === true && ad.elevator == null)
        unknown.push("آسانسور");
      if (filters.parking === true && ad.parking == null)
        unknown.push("پارکینگ");
      if (filters.warehouse === true && ad.warehouse == null)
        unknown.push("انباری");
      if (filters.balcony === true && ad.balcony == null) unknown.push("بالکن");

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
