import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createAuthHandler } from "./auth-handler.js";

function createMockPrisma() {
    const state = { otpCodes: [], users: [], sessions: [] };
    const transaction = {
        otpCode: {
            async deleteMany({ where }) {
                const previousLength = state.otpCodes.length;
                state.otpCodes = state.otpCodes.filter((otp) => {
                    if (where.phone) return otp.phone !== where.phone;
                    if (where.id && otp.id !== where.id) return true;
                    if (where.codeHash && otp.codeHash !== where.codeHash) {
                        return true;
                    }
                    if (
                        where.expiresAt?.gt &&
                        otp.expiresAt <= where.expiresAt.gt
                    ) {
                        return true;
                    }
                    if (
                        where.attempts?.lt !== undefined &&
                        otp.attempts >= where.attempts.lt
                    ) {
                        return true;
                    }
                    return false;
                });
                return { count: previousLength - state.otpCodes.length };
            },
            async create({ data }) {
                const otp = {
                    id: randomUUID(),
                    attempts: 0,
                    createdAt: new Date(),
                    ...data,
                };
                state.otpCodes.push(otp);
                return otp;
            },
            async findFirst({ where }) {
                return (
                    state.otpCodes
                        .filter((otp) => otp.phone === where.phone)
                        .sort(
                            (left, right) => right.createdAt - left.createdAt,
                        )[0] ?? null
                );
            },
            async updateMany({ where }) {
                const otp = state.otpCodes.find((item) => item.id === where.id);
                if (!otp || otp.attempts >= where.attempts.lt)
                    return { count: 0 };
                otp.attempts += 1;
                return { count: 1 };
            },
        },
        user: {
            async upsert({ where, create, update }) {
                let user = state.users.find(
                    (item) => item.phone === where.phone,
                );
                if (!user) {
                    user = {
                        id: randomUUID(),
                        createdAt: new Date(),
                        ...create,
                    };
                    state.users.push(user);
                }
                user.updatedAt = update.updatedAt;
                return user;
            },
        },
        session: {
            async findUnique({ where, include }) {
                const session = state.sessions.find(
                    (item) => item.id === where.id,
                );
                if (!session) return null;
                const user = state.users.find(
                    (item) => item.id === session.userId,
                );
                if (!include?.user) return session;
                return { ...session, user: { ...user } };
            },
            async create({ data }) {
                const session = {
                    id: randomUUID(),
                    connectedAt: new Date(),
                    isActive: true,
                    ...data,
                };
                state.sessions.push(session);
                return { id: session.id };
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
    };

    return {
        state,
        prisma: { $transaction: (callback) => callback(transaction) },
    };
}

test("mock OTP signup verifies the code and creates a user", async () => {
    const { prisma, state } = createMockPrisma();
    const messages = [];
    const handleAuth = createAuthHandler({ prisma });
    const ws = { send: (message) => messages.push(JSON.parse(message)) };

    await handleAuth(ws, { action: "request_otp", phone: "۰۹۱۲۳۴۵۶۷۸۹" });
    const sent = messages.at(-1);

    assert.equal(sent.type, "otp-sent");
    assert.equal(sent.phone, "09123456789");
    assert.equal(sent.mock, true);
    assert.match(sent.mockCode, /^\d{4}$/);
    assert.notEqual(state.otpCodes[0].codeHash, sent.mockCode);

    await handleAuth(ws, {
        action: "verify_otp",
        phone: sent.phone,
        code: Number(sent.mockCode),
    });

    const completed = messages.at(-1);
    assert.equal(completed.type, "signup-complete");
    assert.equal(completed.user.phone, sent.phone);
    assert.equal(ws.userId, completed.user.id);
    assert.equal(state.sessions.length, 1);
    assert.equal(state.sessions[0].userId, completed.user.id);
    assert.equal(ws.sessionId, state.sessions[0].id);
    assert.equal(state.users.length, 1);
    assert.equal(state.otpCodes.length, 0);
});

test("resume_session re-authenticates a new socket without an OTP", async () => {
    const { prisma, state } = createMockPrisma();
    const messages = [];
    const handleAuth = createAuthHandler({ prisma });
    const signupWs = { send: (m) => messages.push(JSON.parse(m)) };

    await handleAuth(signupWs, { action: "request_otp", phone: "09123456789" });
    const otp = messages.at(-1);
    await handleAuth(signupWs, {
        action: "verify_otp",
        phone: otp.phone,
        code: otp.mockCode,
    });
    const completed = messages.at(-1);

    const resumeMessages = [];
    const resumeWs = { send: (m) => resumeMessages.push(JSON.parse(m)) };
    await handleAuth(resumeWs, {
        action: "resume_session",
        phone: completed.user.phone,
        sessionId: completed.sessionId,
    });

    const resumed = resumeMessages.at(-1);
    assert.equal(resumed.type, "session-resumed");
    assert.equal(resumed.user.id, completed.user.id);
    assert.equal(resumeWs.userId, completed.user.id);
    assert.notEqual(resumed.sessionId, completed.sessionId);
    assert.equal(state.sessions.length, 2);
    assert.equal(state.sessions[0].isActive, false);
    assert.equal(state.sessions[1].isActive, true);

    const wrongMessages = [];
    await handleAuth(
        { send: (m) => wrongMessages.push(JSON.parse(m)) },
        { action: "resume_session", phone: "09123456789", sessionId: "nope" },
    );
    assert.equal(wrongMessages.at(-1).type, "auth-error");
});

test("mock OTP requests are rejected when disabled", async () => {
    const { prisma } = createMockPrisma();
    const messages = [];
    const handleAuth = createAuthHandler({ prisma, allowMockOtp: false });

    await handleAuth(
        { send: (message) => messages.push(JSON.parse(message)) },
        { action: "request_otp", phone: "+12025550123" },
    );

    assert.deepEqual(messages[0], {
        type: "auth-error",
        action: "request_otp",
        message: "Mock OTP is disabled in production",
    });
});
