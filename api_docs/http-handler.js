import { readFile } from "node:fs/promises";
import { getPublicApiRegistry } from "./api-registry.js";

const docsPage = new URL("./index.html", import.meta.url);

export async function handleHttpRequest(request, response) {
    const pathname = new URL(request.url || "/", "http://localhost").pathname;

    if (request.method === "GET" && pathname === "/") {
        response.writeHead(302, { Location: "/docs" });
        response.end();
        return;
    }

    if (request.method === "GET" && pathname === "/api-docs.json") {
        response.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        });
        response.end(JSON.stringify(getPublicApiRegistry()));
        return;
    }

    if (
        request.method === "GET" &&
        (pathname === "/docs" || pathname === "/docs/")
    ) {
        try {
            const page = await readFile(docsPage);
            response.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
            });
            response.end(page);
        } catch (error) {
            console.error("[Docs] Failed to read API page:", error.message);
            response.writeHead(500, {
                "Content-Type": "text/plain; charset=utf-8",
            });
            response.end("API documentation is unavailable");
        }
        return;
    }

    response.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ error: "Not found" }));
}
