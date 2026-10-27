import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Game } from "./game.js";
import { createServer } from "./http.js";
import {makeSpeedway} from '../track.js';
const root = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.GAME_DB ?? path.join(root, "data/game.sqlite");
mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
const game = new Game(dbPath,{track:makeSpeedway()});
const server = createServer(game, {
  site: path.join(root, "../site"),
  origins: (process.env.GAME_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === "1",
});
server.listen(
  Number(process.env.PORT ?? 8771),
  process.env.HOST ?? "127.0.0.1",
  () =>
    console.log(
      `CarRace service listening on ${JSON.stringify(server.address())}`,
    ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      game.close();
      process.exit(0);
    }),
  );
