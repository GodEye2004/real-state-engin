import { createHash, randomInt, timingSafeEqual } from "node:crypto";

const OTP_LIFETIME_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function toEnglishDigits(value) {
    return value.replace(/[۰-۹٠-٩]/g, (digit) => {
        const persianIndex = PERSIAN_DIGITS.indexOf(digit);
        const digitIndex =
            persianIndex === -1 ? ARABIC_DIGITS.indexOf(digit) : persianIndex;
        return String(digitIndex);
    });
}

function normalizePhone(value) {
    if (typeof value !== "string") return null;

    const phone = toEnglishDigits(value.trim()).replace(/[\s()-]/g, "");
    return /^\+?\d{8,15}$/.test(phone) ? phone : null;
}

function hashCode(code) {
    return createHash("sha256").update(code).digest("hex");
}

function send(ws, message) {
    ws.send(JSON.stringify(message));
}

export function createAuthHandler({
    prisma,
    allowMockOtp = process.env.NODE_ENV !== "production",
    otpLifetimeMs = OTP_LIFETIME_MS,
    maxOtpAttempts = MAX_OTP_ATTEMPTS,
    onSessionClosed = () => {},
}) {
    async function requestOtp(ws, value) {
        const phone = normalizePhone(value);
        if (!phone) {
            send(ws, {
                type: "auth-error",
                action: "request_otp",
                message: "Enter a valid phone number",
            });
            return;
        }

        if (!allowMockOtp) {
            send(ws, {
                type: "auth-error",
                action: "request_otp",
                message: "Mock OTP is disabled in production",
            });
            return;
        }

        const code = String(randomInt(1000, 10000));
        const expiresAt = new Date(Date.now() + otpLifetimeMs);

        try {
            await prisma.$transaction(async (transaction) => {
                await transaction.otpCode.deleteMany({ where: { phone } });
                await transaction.otpCode.create({
                    data: {
                        phone,
                        codeHash: hashCode(code),
                        expiresAt,
                    },
                });
            });

            send(ws, {
                type: "otp-sent",
                phone,
                mock: true,
                mockCode: code,
                expiresIn: Math.floor(otpLifetimeMs / 1000),
            });
        } catch (error) {
            console.error("[Auth] OTP request failed:", error.message);
            send(ws, {
                type: "auth-error",
                action: "request_otp",
                message: "Could not create an OTP",
            });
        }
    }

    async function verifyOtp(ws, phoneValue, codeValue) {
        const phone = normalizePhone(phoneValue);
        const code =
            typeof codeValue === "string" || typeof codeValue === "number"
                ? toEnglishDigits(String(codeValue).trim())
                : "";

        if (!phone || !/^\d{4}$/.test(code)) {
            send(ws, {
                type: "auth-error",
                action: "verify_otp",
                message: "Enter a valid phone number and four-digit code",
            });
            return;
        }

        try {
            const result = await prisma.$transaction(async (transaction) => {
                const otp = await transaction.otpCode.findFirst({
                    where: { phone },
                    orderBy: { createdAt: "desc" },
                });
                const now = new Date();

                if (!otp || otp.expiresAt <= now) {
                    if (otp) {
                        await transaction.otpCode.deleteMany({
                            where: { id: otp.id },
                        });
                    }
                    return { error: "OTP is missing or expired" };
                }

                if (otp.attempts >= maxOtpAttempts) {
                    await transaction.otpCode.deleteMany({
                        where: { id: otp.id },
                    });
                    return { error: "OTP attempt limit reached" };
                }

                const storedHash = Buffer.from(otp.codeHash, "hex");
                const submittedHash = Buffer.from(hashCode(code), "hex");
                if (
                    storedHash.length !== submittedHash.length ||
                    !timingSafeEqual(storedHash, submittedHash)
                ) {
                    await transaction.otpCode.updateMany({
                        where: {
                            id: otp.id,
                            attempts: { lt: maxOtpAttempts },
                        },
                        data: { attempts: { increment: 1 } },
                    });
                    return { error: "Invalid or expired OTP" };
                }

                const consumed = await transaction.otpCode.deleteMany({
                    where: {
                        id: otp.id,
                        codeHash: otp.codeHash,
                        expiresAt: { gt: now },
                        attempts: { lt: maxOtpAttempts },
                    },
                });
                if (consumed.count !== 1) {
                    return { error: "Invalid or expired OTP" };
                }

                const user = await transaction.user.upsert({
                    where: { phone },
                    create: { phone },
                    update: { updatedAt: now },
                    select: {
                        id: true,
                        phone: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                });

                let closedSessionId = null;
                if (ws.sessionId && ws.userId) {
                    await transaction.session.updateMany({
                        where: {
                            id: ws.sessionId,
                            userId: ws.userId,
                            isActive: true,
                        },
                        data: { disconnectedAt: now, isActive: false },
                    });
                    closedSessionId = ws.sessionId;
                }

                const session = await transaction.session.create({
                    data: { userId: user.id },
                    select: { id: true },
                });

                return { user, sessionId: session.id, closedSessionId };
            });

            if (result.error) {
                send(ws, {
                    type: "auth-error",
                    action: "verify_otp",
                    message: result.error,
                });
                return;
            }

            if (result.closedSessionId) onSessionClosed(result.closedSessionId);
            ws.userId = result.user.id;
            ws.sessionId = result.sessionId;
            send(ws, { type: "signup-complete", user: result.user });
        } catch (error) {
            console.error("[Auth] OTP verification failed:", error.message);
            send(ws, {
                type: "auth-error",
                action: "verify_otp",
                message: "Could not verify the OTP",
            });
        }
    }

    return async function handleAuth(ws, data) {
        if (data.action === "request_otp") {
            await requestOtp(ws, data.phone);
        } else if (data.action === "verify_otp") {
            await verifyOtp(ws, data.phone, data.code);
        }
    };
}
