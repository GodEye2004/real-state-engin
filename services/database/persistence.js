function toInteger(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
}

function toBigInt(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "bigint") return value;
    if (typeof value === "number") {
        return Number.isSafeInteger(value) ? BigInt(value) : null;
    }

    const normalized = String(value).replaceAll(",", "").trim();
    if (!/^-?\d+$/.test(normalized)) return null;
    return BigInt(normalized);
}

function toDate(value) {
    if (value === null || value === undefined || value === "") return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function adFields(ad, { includeNulls = false } = {}) {
    const fields = {
        title: ad.title ?? null,
        link: ad.link ?? null,
        details: ad.details ?? null,
        area: toInteger(ad.area),
        price: toBigInt(ad.price),
        rent: toBigInt(ad.rent),
        credit: toBigInt(ad.credit),
        rooms: toInteger(ad.rooms),
        floor: toInteger(ad.floor),
        floorsCount: toInteger(ad.floorsCount ?? ad.floors_count),
        buildingAge: toInteger(ad.buildingAge ?? ad.building_age),
        type: ad.type ?? null,
        elevator: ad.elevator ?? null,
        parking: ad.parking ?? null,
        warehouse: ad.warehouse ?? null,
        balcony: ad.balcony ?? null,
        district: ad.district ?? null,
        rawDetails: ad.raw_details ?? ad.rawDetails ?? null,
        checkedAt: toDate(ad.checked_at ?? ad.checkedAt),
    };

    if (includeNulls) return fields;
    return Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== null),
    );
}

export async function createSearchRecord(
    prisma,
    { userId, sessionId, query, filters },
) {
    if (!userId || !sessionId) {
        throw new Error("An authenticated user session is required to search");
    }

    const activeSession = await prisma.session.findFirst({
        where: { id: sessionId, userId, isActive: true },
        select: { id: true },
    });
    if (!activeSession) {
        throw new Error("The active session does not belong to this user");
    }

    return prisma.search.create({
        data: {
            userId,
            sessionId,
            query: String(query || "Property search").trim(),
            filters,
        },
        select: { id: true },
    });
}

export async function persistSearchResults(prisma, { searchId, userId, ads }) {
    return prisma.$transaction(
        async (transaction) => {
            const search = await transaction.search.findFirst({
                where: { id: searchId, userId },
                select: { id: true },
            });
            if (!search) {
                throw new Error("Search does not belong to this user");
            }

            let savedCount = 0;
            for (const ad of ads) {
                const externalId = String(
                    ad.external_id ?? ad.externalId ?? ad.link ?? ad.id ?? "",
                ).trim();
                if (!externalId) continue;

                const createData = {
                    externalId,
                    ...adFields(ad, { includeNulls: true }),
                };
                const adRecord = await transaction.ad.upsert({
                    where: { externalId },
                    create: createData,
                    update: {
                        ...adFields(ad),
                        updatedAt: new Date(),
                    },
                    select: { id: true },
                });

                const score = Number(ad.matchScore);
                const matchScore = Number.isFinite(score)
                    ? String(score)
                    : null;
                const matchBreakdown =
                    ad.matchBreakdown && typeof ad.matchBreakdown === "object"
                        ? ad.matchBreakdown
                        : undefined;
                const data = {
                    matchScore,
                    isBestMatch: ad.isBestMatch === true,
                    ...(matchBreakdown ? { matchBreakdown } : {}),
                };

                await transaction.searchResult.upsert({
                    where: {
                        searchId_adId: {
                            searchId,
                            adId: adRecord.id,
                        },
                    },
                    create: {
                        searchId,
                        adId: adRecord.id,
                        ...data,
                    },
                    update: data,
                });
                savedCount += 1;
            }

            return savedCount;
        },
        { timeout: 60000 },
    );
}

export async function closeUserSession(prisma, { sessionId, userId }) {
    if (!sessionId || !userId) return 0;

    const result = await prisma.session.updateMany({
        where: { id: sessionId, userId, isActive: true },
        data: { disconnectedAt: new Date(), isActive: false },
    });
    return result.count;
}
