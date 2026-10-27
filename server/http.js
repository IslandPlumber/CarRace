import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { GameError } from "./game.js";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".md": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
export function createServer(
  game,
  { site, origins = [], trustProxy = false } = {},
) {
  const limits = new Map();
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    try {
      const url = new URL(req.url, "http://localhost"),
        api = url.pathname.startsWith("/api/");
      if (api) {
        const origin = req.headers.origin,
          own = `${trustProxy && req.headers["x-forwarded-proto"] === "https" ? "https" : "http"}://${req.headers.host}`;
        if (origin && origin !== own) {
          if (!origins.includes(origin))
            throw new GameError(
              "This website is not allowed to access the game server.",
              403,
            );
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Vary", "Origin");
        }
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          });
          res.end();
          return;
        }
        const ip = trustProxy
          ? (req.headers["x-forwarded-for"] ?? "").split(",").at(-1).trim() ||
            req.socket.remoteAddress
          : req.socket.remoteAddress;
        const now = Date.now();
        if (limits.size > 10000)
          for (const [k, v] of limits) if (v.reset <= now) limits.delete(k);
        const isAuth = ["/api/login", "/api/register"].includes(url.pathname),
          key = `${ip}:${isAuth ? "auth" : "api"}`;
        let bucket = limits.get(key);
        if (!bucket || bucket.reset <= now) {
          bucket = { count: 0, reset: now + 60000 };
          limits.set(key, bucket);
        }
        if (++bucket.count > (isAuth ? 12 : 1800))
          throw new GameError("Too many requests. Try again in a minute.", 429);
        let body = {};
        if (req.method === "POST") {
          if (
            !(req.headers["content-type"] ?? "").startsWith("application/json")
          )
            throw new GameError("Send JSON.", 415);
          let bytes = 0,
            chunks = [];
          for await (const c of req) {
            bytes += c.length;
            if (bytes > 8192) throw new GameError("Request is too large.", 413);
            chunks.push(c);
          }
          try {
            body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
          } catch {
            throw new GameError("Invalid JSON.");
          }
          if (!body || typeof body !== "object" || Array.isArray(body))
            throw new GameError("Expected a JSON object.");
        }
        game.tick();
        const route = `${req.method} ${url.pathname}`;
        if (route === "GET /api/health") {
          send(200, { ok: true, serverTime: game.clock() });
          return;
        }
        if (route === "POST /api/register" || route === "POST /api/login") {
          send(
            200,
            route.endsWith("register")
              ? game.register(body.username, body.password)
              : game.login(body.username, body.password),
          );
          return;
        }
        const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1],
          id = game.auth(token);
        let result;
        switch (route) {
          case "GET /api/me":
            result = game.me(id);
            break;
          case "POST /api/logout":
            game.logout(token);
            result = { ok: true };
            break;
          case "POST /api/car":
            game.car(id, body.car);
            result = game.me(id);
            break;
          case "POST /api/upgrades":
            game.upgrade(id, body.kind, body.level);
            result = game.me(id);
            break;
          case "GET /api/ledger":
            result = { entries: game.ledger(id) };
            break;
          case "GET /api/history":
            result = { history: game.history(id,{betsOnly:url.searchParams.get("betsOnly")==="1"}) };
            break;
          case "GET /api/rooms":
            result = { rooms: game.rooms(), online: game.onlineCount() };
            break;
          case "POST /api/arrival":
            game.arrive(id);
            result=game.me(id);
            break;
          case "POST /api/rooms/main":
            game.arrive(id,{switchRoom:true});
            result=game.me(id);
            break;
          case "POST /api/rooms":
            result = { code: game.create(id) };
            break;
          default: {
            const match = url.pathname.match(
              /^\/api\/rooms\/([A-Fa-f0-9]{6})(?:\/(join|leave|start|bets|power))?$/,
            );
            if (!match) throw new GameError("Not found.", 404);
            const code = match[1].toUpperCase(),
              action = match[2];
            if (req.method === "GET" && !action)
              result = { room: game.room(id, code) };
            else if (req.method === "POST" && action) {
              if (action === "join") game.join(id, code, body.car);
              else if (action === "leave") {
                requireMembership();
                game.leave(id);
              } else if (action === "start") game.start(id, code);
              else if(action==="power")game.power(id,code,body.raceId,body.requestId,body.policyVersion);
              else game.bet(id, code, body.car, body.stake, body.kind);
              result = action==="power"?{code,room:game.room(id,code),user:game.profile(id)}:{code};
            } else throw new GameError("Not found.", 404);
            function requireMembership() {
              if (game.membership(id) !== code)
                throw new GameError("Join this room first.", 403);
            }
          }
        }
        send(200, { ...result, serverTime: game.clock() });
        return;
      }
      if (!site || !["GET", "HEAD"].includes(req.method))
        throw new GameError("Not found.", 404);
      let relative;
      try {
        relative = decodeURIComponent(url.pathname);
      } catch {
        throw new GameError("Invalid path.");
      }
      const file = path.resolve(
        site,
        "." + (relative === "/" ? "/index.html" : relative),
      );
      if (
        !file.startsWith(path.resolve(site) + path.sep) ||
        relative.split("/").some((p) => p.startsWith("."))
      )
        throw new GameError("Not found.", 404);
      let info;
      try {
        info = await stat(file);
      } catch {
        throw new GameError("Not found.", 404);
      }
      if (!info.isFile()) throw new GameError("Not found.", 404);
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": /\.(html|js|css|json)$/.test(file)
          ? "no-cache"
          : "public, max-age=3600",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      });
      res.end(req.method === "HEAD" ? undefined : await readFile(file));
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (!(error instanceof GameError))
        console.error("Game request failed:", error.message);
      send(error.status ?? 500, {
        error:
          error instanceof GameError
            ? error.message
            : "The server could not complete that request.",
      });
    }
  });
  const timer = setInterval(() => {
    try {
      game.tick();
    } catch (e) {
      console.error("Race update failed:", e.message);
    }
  }, 1000);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  return server;
}
