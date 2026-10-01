import { PrismaClient } from "@prisma/client";

export function createDatabaseUrl(env = process.env) {
    const username = env.DB_USER || env.USER;
    const password = env.DB_PASSWORD || env.PASSWORD;
    const port = env.DB_PORT || env.PORT || "5432";

    if (!env.HOST || !env.DATABASE || !username || !password) {
        throw new Error(
            "Database configuration requires HOST, DATABASE, USER, and PASSWORD",
        );
    }

    const url = new URL("postgresql://localhost");
    url.hostname = env.HOST;
    url.port = String(port);
    url.username = username;
    url.password = password;
    url.pathname = `/${env.DATABASE}`;
    url.searchParams.set("schema", env.DB_SCHEMA || "public");

    if (env.DB_SSL === "true") url.searchParams.set("sslmode", "require");

    return url.toString();
}

export function createDatabaseClient(env = process.env) {
    return new PrismaClient({
        datasources: {
            db: { url: createDatabaseUrl(env) },
        },
    });
}

export async function connectDatabase(prisma) {
    await prisma.$queryRaw`SELECT 1`;
    console.log("[Database] Prisma connected to PostgreSQL");
}
