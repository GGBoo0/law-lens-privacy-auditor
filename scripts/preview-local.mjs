// Local-only adapter for the built Cloudflare Worker. Its temporary SQLite
// database implements the rate-limit operations; it is never used for hosting.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { nodeToWebRequest, sendWebResponse, tryServeStatic } from "vinext/server/prod-server";
import worker from "../dist/server/index.js";

const port = Number(process.env.PORT || 4173);
const clientDirectory = fileURLToPath(new URL("../dist/client", import.meta.url));
const database = new DatabaseSync(":memory:");
const migrationsDirectory = new URL("../drizzle/", import.meta.url);
for (const name of readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort()) {
  database.exec(readFileSync(new URL(name, migrationsDirectory), "utf8"));
}
const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  RATE_LIMIT_HMAC_SECRET: randomBytes(32).toString("hex"),
  DB: {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        bind(...values) {
          return {
            async first() { return statement.get(...values) ?? null; },
            async run() { statement.run(...values); return { success: true }; },
          };
        },
      };
    },
  },
};
const server = createServer(async (request, response) => {
  try {
    const host = `127.0.0.1:${port}`;
    if (request.headers.host !== host && request.headers.host !== `localhost:${port}`) {
      response.writeHead(400).end("Invalid local host");
      return;
    }
    const pathname = new URL(request.url, `http://${host}`).pathname;
    if (await tryServeStatic(request, response, clientDirectory, pathname, false)) return;
    // This adapter is the local edge, so derive the identity from the socket.
    request.headers["cf-connecting-ip"] = request.socket.remoteAddress;
    delete request.headers["x-forwarded-host"];
    delete request.headers["x-forwarded-proto"];
    const result = await worker.fetch(nodeToWebRequest(request), env, {
      waitUntil(promise) { promise.catch(console.error); },
      passThroughOnException() {},
    });
    await sendWebResponse(result, request, response, false);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) response.writeHead(500);
    response.end("Local preview failed");
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Local preview: http://127.0.0.1:${port}`);
  console.log("Temporary local rate-limit database; restart after rebuilding.");
});
