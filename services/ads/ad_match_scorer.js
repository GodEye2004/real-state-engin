export const MATCH_CONFIG = {
    weights: {
        budget: 0.45,
        buildingAge: 0.3,
        area: 0.25,
        location: 0.2,
    },
    tolerances: {
        budgetOverrunFraction: 0.25,
        minimumBudgetOverrun: 100_000_000,
        buildingAgeYears: 5,
        areaSquareMeters: 10,
    },
};

function finiteNumber(value) {
    if (typeof value === "string") value = value.replaceAll(",", "").trim();
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function firstNumber(source, keys) {
    for (const key of keys) {
        const value = finiteNumber(source[key]);
        if (value !== null) return value;
    }
    return null;
}

function clampScore(value) {
    return Math.max(0, Math.min(100, value));
}

function scoreBoundedValue(value, min, max, tolerance) {
    if (value === null) return null;
    const rangeWidth = min !== null && max !== null ? Math.abs(max - min) : 0;
    if (min !== null && value < min) {
        const allowedDistance = Math.max(rangeWidth, tolerance);
        return clampScore(100 * (1 - (min - value) / allowedDistance));
    }
    if (max !== null && value > max) {
        const allowedDistance = Math.max(rangeWidth, tolerance);
        return clampScore(100 * (1 - (value - max) / allowedDistance));
    }
    return 100;
}

function buildCriteria(preferences, config) {
    const priceMin = firstNumber(preferences, ["price_min", "budget_min"]);
    const priceMax = firstNumber(preferences, [
        "price_max",
        "budget_max",
        "budget",
    ]);
    const areaMin = firstNumber(preferences, ["size_min", "area_min"]);
    const areaMax = firstNumber(preferences, ["size_max", "area_max"]);
    const ageMin = firstNumber(preferences, [
        "building_age_min",
        "min_building_age",
    ]);
    const ageMax = firstNumber(preferences, [
        "building_age_max",
        "buildingAgeMax",
        "max_building_age",
    ]);
    const location =
        preferences.district ??
        preferences.neighborhood ??
        preferences.preferredArea ??
        preferences.location ??
        null;

    const criteria = [];
    if (priceMin !== null || priceMax !== null) {
        const budgetTolerance = Math.max(
            (priceMax ?? priceMin) * config.tolerances.budgetOverrunFraction,
            config.tolerances.minimumBudgetOverrun,
        );
        criteria.push({
            name: "budget",
            weight: config.weights.budget,
            score: (ad) =>
                scoreBoundedValue(
                    finiteNumber(ad.price),
                    priceMin,
                    priceMax,
                    budgetTolerance,
                ),
        });
    }

    if (areaMin !== null || areaMax !== null) {
        criteria.push({
            name: "area",
            weight: config.weights.area,
            score: (ad) =>
                scoreBoundedValue(
                    finiteNumber(ad.area),
                    areaMin,
                    areaMax,
                    config.tolerances.areaSquareMeters,
                ),
        });
    }

    if (ageMin !== null || ageMax !== null) {
        criteria.push({
            name: "buildingAge",
            weight: config.weights.buildingAge,
            score: (ad) =>
                scoreBoundedValue(
                    finiteNumber(ad.buildingAge),
                    ageMin,
                    ageMax,
                    config.tolerances.buildingAgeYears,
                ),
        });
    }

    if (typeof location === "string" && location.trim()) {
        const desiredLocation = location.trim().toLocaleLowerCase();
        criteria.push({
            name: "location",
            weight: config.weights.location,
            score: (ad) => {
                if (typeof ad.district !== "string" || !ad.district.trim())
                    return null;
                const adLocation = ad.district.trim().toLocaleLowerCase();
                return adLocation.includes(desiredLocation) ||
                    desiredLocation.includes(adLocation)
                    ? 100
                    : 0;
            },
        });
    }

    return criteria.filter(
        (criterion) =>
            Number.isFinite(criterion.weight) && criterion.weight > 0,
    );
}

function scoreAd(ad, criteria) {
    const matchBreakdown = {};
    let weightedScore = 0;
    let totalWeight = 0;

    for (const criterion of criteria) {
        const score = criterion.score(ad);
        matchBreakdown[criterion.name] = score;
        const effectiveScore = score ?? 50;
        weightedScore += effectiveScore * criterion.weight;
        totalWeight += criterion.weight;
    }

    return {
        matchScore: totalWeight
            ? Math.round(weightedScore / totalWeight)
            : null,
        matchBreakdown,
    };
}

export function scoreAds(ads, preferences = {}, overrides = {}) {
    if (!Array.isArray(ads)) throw new TypeError("ads must be an array");

    const config = {
        ...MATCH_CONFIG,
        ...overrides,
        weights: { ...MATCH_CONFIG.weights, ...overrides.weights },
        tolerances: { ...MATCH_CONFIG.tolerances, ...overrides.tolerances },
    };
    const criteria = buildCriteria(preferences, config);
    const scoredAds = ads.map((ad, index) => ({
        ...ad,
        ...scoreAd(ad, criteria),
        isBestMatch: false,
        originalIndex: index,
    }));

    if (criteria.length === 0 || scoredAds.length === 0) {
        return scoredAds.map(({ originalIndex, ...ad }) => ad);
    }

    scoredAds.sort(
        (left, right) =>
            right.matchScore - left.matchScore ||
            left.originalIndex - right.originalIndex,
    );
    scoredAds[0].isBestMatch = true;

    return scoredAds.map(({ originalIndex, ...ad }) => ad);
}
