import assert from "node:assert/strict";
import test from "node:test";
import {
    closeUserSession,
    createSearchRecord,
    persistSearchResults,
} from "./persistence.js";

function createPersistencePrisma() {
    const state = { searches: [], ads: [], results: [], sessions: [] };
    const transaction = {
        search: {
            async findFirst({ where }) {
                return (
                    state.searches.find(
                        (search) =>
                            search.id === where.id &&
                            search.userId === where.userId,
                    ) ?? null
                );
            },
        },
        ad: {
            async upsert({ where, create, update }) {
                let ad = state.ads.find(
                    (item) => item.externalId === where.externalId,
                );
                if (!ad) {
                    ad = { id: `ad-${state.ads.length + 1}`, ...create };
                    state.ads.push(ad);
                } else {
                    Object.assign(ad, update);
                }
                return { id: ad.id };
            },
        },
        searchResult: {
            async upsert({ where, create, update }) {
                const key = where.searchId_adId;
                let result = state.results.find(
                    (item) =>
                        item.searchId === key.searchId &&
                        item.adId === key.adId,
                );
                if (!result) {
                    result = { ...create };
                    state.results.push(result);
                } else {
                    Object.assign(result, update);
                }
                return result;
            },
        },
    };

    return {
        state,
        prisma: {
            session: {
                async findFirst({ where }) {
                    return (
                        state.sessions.find(
                            (session) =>
                                session.id === where.id &&
                                session.userId === where.userId &&
                                session.isActive === where.isActive,
                        ) ?? null
                    );
                },
                async updateMany({ where, data }) {
                    const session = state.sessions.find(
                        (item) =>
                            item.id === where.id &&
                            item.userId === where.userId &&
                            item.isActive,
                    );
                    if (!session) return { count: 0 };
                    Object.assign(session, data);
                    return { count: 1 };
                },
            },
            search: {
                async create({ data }) {
                    const record = {
                        id: `search-${state.searches.length + 1}`,
                        ...data,
                    };
                    state.searches.push(record);
                    return { id: record.id };
                },
            },
            $transaction: (callback) => callback(transaction),
        },
    };
}

test("searches and match results stay linked to the authenticated user", async () => {
    const { prisma, state } = createPersistencePrisma();
    state.sessions.push({ id: "session-1", userId: "user-1", isActive: true });

    const search = await createSearchRecord(prisma, {
        userId: "user-1",
        sessionId: "session-1",
        query: "apartment gorgan",
        filters: { city: "gorgan", price_max: 5000000000 },
    });
    const savedCount = await persistSearchResults(prisma, {
        searchId: search.id,
        userId: "user-1",
        ads: [
            {
                id: "https://divar.ir/v/ad-1",
                link: "https://divar.ir/v/ad-1",
                title: "Apartment",
                price: 5000000000,
                area: 120,
                matchScore: 95,
                matchBreakdown: { budget: 100, area: 90 },
                isBestMatch: true,
            },
        ],
    });

    assert.equal(state.searches[0].userId, "user-1");
    assert.equal(state.searches[0].sessionId, "session-1");
    assert.equal(state.ads[0].externalId, "https://divar.ir/v/ad-1");
    assert.equal(state.ads[0].price, 5000000000n);
    assert.equal(state.results[0].searchId, search.id);
    assert.equal(state.results[0].adId, state.ads[0].id);
    assert.equal(state.results[0].matchScore, "95");
    assert.deepEqual(state.results[0].matchBreakdown, {
        budget: 100,
        area: 90,
    });
    assert.equal(state.results[0].isBestMatch, true);
    assert.equal(savedCount, 1);
});

test("the same ad is shared while match results remain unique per user search", async () => {
    const { prisma, state } = createPersistencePrisma();
    state.sessions.push(
        { id: "session-1", userId: "user-1", isActive: true },
        { id: "session-2", userId: "user-2", isActive: true },
    );

    const firstSearch = await createSearchRecord(prisma, {
        userId: "user-1",
        sessionId: "session-1",
        query: "apartment gorgan",
        filters: { price_max: 5000000000 },
    });
    const secondSearch = await createSearchRecord(prisma, {
        userId: "user-2",
        sessionId: "session-2",
        query: "villa gorgan",
        filters: { price_max: 8000000000 },
    });
    const ad = {
        id: "https://divar.ir/v/shared-ad",
        link: "https://divar.ir/v/shared-ad",
        title: "Shared listing",
    };

    await persistSearchResults(prisma, {
        searchId: firstSearch.id,
        userId: "user-1",
        ads: [{ ...ad, matchScore: 95, isBestMatch: true }],
    });
    await persistSearchResults(prisma, {
        searchId: secondSearch.id,
        userId: "user-2",
        ads: [{ ...ad, matchScore: 63, isBestMatch: false }],
    });

    assert.equal(state.ads.length, 1);
    assert.equal(state.results.length, 2);
    assert.equal(state.results[0].adId, state.results[1].adId);
    assert.notEqual(state.results[0].searchId, state.results[1].searchId);
    assert.deepEqual(state.results.map((result) => result.matchScore).sort(), [
        "63",
        "95",
    ]);
});

test("search creation rejects sessions owned by another user", async () => {
    const { prisma } = createPersistencePrisma();
    await assert.rejects(
        createSearchRecord(prisma, {
            userId: "user-1",
            sessionId: "other-session",
            query: "apartment",
            filters: {},
        }),
        /does not belong to this user/,
    );
});

test("closing a session updates only the matching user's active session", async () => {
    const { prisma, state } = createPersistencePrisma();
    state.sessions.push({ id: "session-1", userId: "user-1", isActive: true });

    assert.equal(
        await closeUserSession(prisma, {
            sessionId: "session-1",
            userId: "user-1",
        }),
        1,
    );
    assert.equal(state.sessions[0].isActive, false);
    assert.ok(state.sessions[0].disconnectedAt instanceof Date);
});
