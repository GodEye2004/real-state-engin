export const API_OPERATIONS = [
    {
        id: "request-otp",
        group: "Authentication",
        title: "Request mock OTP",
        action: "request_otp",
        handlerKey: "auth",
        description:
            "Create a mock verification code for a phone number. No SMS is sent.",
        request: { action: "request_otp", phone: "09123456789" },
        responses: ["otp-sent", "auth-error"],
        fields: [
            [
                "phone",
                "string",
                "8–15 digits; Persian digits and common separators are accepted.",
            ],
        ],
        example: {
            type: "otp-sent",
            phone: "09123456789",
            mock: true,
            mockCode: "<generated 4-digit code>",
            expiresIn: 300,
        },
        note: "Mock OTP is disabled in production by default. Set OTP_MODE=mock to enable it explicitly.",
    },
    {
        id: "verify-otp",
        group: "Authentication",
        title: "Verify OTP / sign up",
        action: "verify_otp",
        handlerKey: "auth",
        description:
            "Verify the latest code, consume it, and create or return the user record.",
        request: { action: "verify_otp", phone: "09123456789", code: "1234" },
        responses: ["signup-complete", "auth-error"],
        fields: [
            ["phone", "string", "The same phone used to request the code."],
            [
                "code",
                "string | number",
                "Four-digit code from otp-sent.mockCode.",
            ],
        ],
        example: {
            type: "signup-complete",
            user: {
                id: "uuid",
                phone: "09123456789",
                createdAt: "ISO date",
                updatedAt: "ISO date",
            },
        },
        note: "Codes expire after five minutes, allow five attempts, and can only be used once. This flow does not issue a JWT.",
    },
    {
        id: "structured-search",
        group: "Property search",
        title: "Structured search",
        action: "structured_search",
        handlerKey: "structuredSearch",
        requiresIdle: true,
        description:
            "Search with typed criteria. All criteria are optional; send explicit min/max values for exact bounds.",
        request: {
            action: "structured_search",
            city: "gorgan",
            deal: "sale",
            type: "apartment",
            price_min: 4500000000,
            price_max: 5500000000,
            size_min: 110,
            size_max: 130,
            rooms: 2,
            building_age_max: 5,
            elevator: true,
            parking: true,
            query: "آپارتمان گرگان",
        },
        responses: [
            "applied-filters",
            "status",
            "screenshot",
            "results",
            "ad-count",
            "info",
        ],
        fields: [
            ["city", "string", "City name/slug; defaults to gorgan."],
            ["deal", "sale | rent", "Defaults to sale."],
            [
                "type",
                "string",
                "apartment, villa, house, land, office, or store.",
            ],
            [
                "category",
                "string",
                "Optional, e.g. buy-apartment or rent-villa.",
            ],
            ["rooms", "number | string", "Bedroom count; 0 means studio."],
            ["price_min/max", "number", "Sale price bounds in Tomans."],
            ["rent_min/max", "number", "Monthly rent bounds in Tomans."],
            ["credit_min/max", "number", "Deposit bounds in Tomans."],
            ["size_min/max", "number", "Area bounds in square meters."],
            ["building_age_min/max", "number", "Building age in years."],
            [
                "elevator, parking, warehouse, balcony",
                "boolean",
                "Set true to require an amenity.",
            ],
            ["query", "string", "Optional Divar phrase."],
            [
                "match_weights",
                "object",
                "Optional ranking weights, e.g. { budget: 0.7, area: 0.3 }.",
            ],
        ],
        example: {
            type: "results",
            isNewSearch: true,
            data: [
                {
                    id: "https://divar.ir/v/...",
                    title: "...",
                    link: "https://divar.ir/v/...",
                    area: 120,
                    price: 5000000000,
                    rooms: 2,
                    matchScore: 96,
                    matchBreakdown: { budget: 100, area: 90 },
                    isBestMatch: true,
                },
            ],
        },
        note: "One request produces multiple frames. Listen until results arrives; screenshot.image is base64 JPEG.",
    },
    {
        id: "text-search",
        group: "Property search",
        title: "Free-text search",
        action: "text_search",
        legacyText: true,
        handlerKey: "textSearch",
        requiresIdle: true,
        description:
            "Send a natural-language search prompt. The backend parses it, then runs structured search.",
        request: {
            action: "text_search",
            text: "آپارتمان ۱۲۰ متری دو خواب گرگان تا ۵ میلیارد",
        },
        responses: [
            "applied-filters",
            "status",
            "screenshot",
            "results",
            "ad-count",
            "info",
        ],
        fields: [
            [
                "text",
                "string",
                "Natural-language request; include property type, location, and criteria.",
            ],
        ],
        example: { type: "results", isNewSearch: true, data: [] },
        note: 'For older clients, { text: "..." } without action is also accepted. This uses the configured AI parser.',
    },
    {
        id: "load-more",
        group: "Property search",
        title: "Load more ads",
        action: "load_more",
        handlerKey: "loadMore",
        requiresIdle: true,
        description:
            "Collect additional unseen ads from the current search. No extra request fields are needed.",
        request: { action: "load_more" },
        responses: ["status", "results", "ad-count", "info"],
        fields: [
            [
                "action",
                "string",
                "Must be load_more. A search must have run first.",
            ],
        ],
        example: { type: "results", isNewSearch: false, data: [] },
        note: "Append data to the current list when isNewSearch is false; ad-count is cumulative.",
    },
];

export const API_RESPONSE_EVENTS = [
    { type: "otp-sent", description: "Mock verification code." },
    {
        type: "signup-complete",
        description: "Created or existing user record.",
    },
    {
        type: "applied-filters",
        description: "Normalized search and post-filters.",
    },
    {
        type: "status",
        description: "Progress step, status, message, and progress.",
    },
    { type: "screenshot", description: "Base64 JPEG screenshot and page URL." },
    { type: "results", description: "Property array and new-search marker." },
    { type: "ad-count", description: "Total results count." },
    {
        type: "notification",
        description: "New ads from background monitoring.",
    },
    { type: "info", description: "Informational or error message." },
    { type: "auth-error", description: "OTP or account error." },
];

export function resolveApiOperation(message) {
    if (typeof message.action === "string") {
        const operation = API_OPERATIONS.find(
            (item) => item.action === message.action,
        );
        if (operation) return operation;
    }

    if (message.text) {
        return API_OPERATIONS.find((item) => item.legacyText) ?? null;
    }

    return null;
}

export function getPublicApiRegistry() {
    return {
        protocol: "websocket",
        endpoint: "/",
        operations: API_OPERATIONS.map(
            ({ handlerKey, requiresIdle, legacyText, ...operation }) =>
                operation,
        ),
        responseEvents: API_RESPONSE_EVENTS,
    };
}
