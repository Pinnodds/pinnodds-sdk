// Post Pinnacle odds drops to a Discord channel, pushed as they happen.
//
//   npm install pinnodds
//   PINNODDS_KEY=... DISCORD_WEBHOOK=https://discord.com/api/webhooks/... node drops-to-discord.mjs
//
// Needs a plan with SSE (the 3-day demo includes it). MIN_DROP=8 for bigger moves only.
import { Client } from "pinnodds";

const api = new Client(process.env.PINNODDS_KEY);
const minDrop = Number(process.env.MIN_DROP || 5);

for await (const d of api.streamDrops({ minDrop })) {
  const fair = d.nvp ? `  (no-vig fair ${Number(d.nvp).toFixed(3)})` : "";
  await fetch(process.env.DISCORD_WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: `**${d.home} v ${d.away}**\n${d.sect} ${d.outcome}: ${d.from_price} -> ${d.to_price}${fair}`,
    }),
  });
}
