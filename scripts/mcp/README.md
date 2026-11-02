# Game MCP server

Lets an AI agent (Claude Code) read and change the **running** dev game without restarting it.

```
agent ──stdio/MCP──> scripts/mcp/game-mcp.mjs ──HTTP 127.0.0.1:8799──> dev page (src/devBridge.ts)
```

1. `npm run dev` and open the game in a browser (a dev build: the page connects on its own, and keeps retrying).
2. Claude Code starts the server from `.mcp.json` (approve it the first time; `/mcp` shows it).
3. Ask for things: "spawn 5 geodudes", "put me in a level 5 cave", "set the pack size to 40", "take a screenshot".

Tools: `game_status`, `game_tools`, `game_call` (any `ps.*` dev console tool), `game_eval` (JS with `g`, `run`, `ps`, `dbg` in scope),
`game_set` (a path in the game state), `game_data` (search/get/set/reset the Data tab's tables, each with when a change takes effect),
`game_tune` (spawn knobs, simulation speed, stat deltas, overlay layers), `game_screenshot`, `game_metrics`, `game_errors`.

Safety: the server listens on 127.0.0.1 only and refuses requests whose `Origin` or `Host` isn't localhost, so a website can't drive
the game or feed the agent answers. `game_eval` runs arbitrary code in your dev page, which is the point; the bridge exists only in
dev builds (`import.meta.env.DEV`). Set `GAME_MCP_PORT` (server) and `VITE_MCP_PORT` (page) to change the port.
