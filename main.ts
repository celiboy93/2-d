import { Hono } from "jsr:@hono/hono"; 
import { getCookie, setCookie } from "jsr:@honajsr:@hono/hono/cookie";
import { kv, User, TwoDResult, TwoDBet, getUser, hashPassword, getConfig, save2DResult } from "./db.ts";

const app = new Hono();

// --- 2D PROXY API (Fetches live data) ---
app.get("/api/2d-proxy", async (c) => {
    const config = await getConfig();
    // Manual Override
    if (config.manual2d && config.manual2d.trim() !== "") {
        return c.json({ live: { twod: config.manual2d, set: "MANUAL", value: "ADMIN", time: "Live" } });
    }
    // API Fetch
    try {
        const res = await fetch("https://api.thaistock2d.com/live"); // Standard 2D API
        const data = await res.json();
        
        // Fallback to History if live is empty (e.g., market closed)
        if (!data.live || !data.live.twod) {
             const historyRes = await fetch("https://api.thaistock2d.com/2d_result");
             const historyData = await historyRes.json();
             if (historyData && historyData.length > 0) {
                 const last = historyData[0];
                 // Save the result internally (optional step for history tracking)
                 await save2DResult({ date: last.date, time: last.open_time, set: last.set, value: last.value, twod: last.twod });
                 return c.json({ live: { twod: last.twod, set: last.set, value: last.value, time: `Closed (${last.open_time})` } });
             }
        }
        return c.json(data);
    } catch {
        return c.json({ live: { twod: "--", set: "Error", value: "Error", time: "Offline" } });
    }
});

// --- BASE LAYOUT (VERY SIMPLIFIED) ---
const Layout = (title: string, content: string) => `
<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title><script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-gray-900 text-white min-h-screen p-4">
    <div class="max-w-md mx-auto">
        <h1 class="text-3xl font-bold text-blue-400 mb-6">${title}</h1>
        ${content}
    </div>
</body></html>
`;


app.get("/", (c) => c.html(Layout("2D Live Betting", `
    <p>Loading 2D System...</p>
    <script>
        // CLIENT JS TO FETCH LIVE DATA (SIMPLIFIED)
        document.addEventListener('DOMContentLoaded', () => {
            setInterval(async () => {
                const res = await fetch('/api/2d-proxy');
                const data = await res.json();
                const live = data.live || {};
                document.getElementById('live-number').innerText = live.twod || '--';
                document.getElementById('set-value').innerText = live.set || '0.00';
            }, 2000);
        });
    </script>
    <div class="bg-slate-800 p-6 rounded-lg text-center">
        <h2 class="text-xl font-semibold text-yellow-400">Live Result</h2>
        <div id="live-number" class="text-6xl font-bold mt-2">--</div>
        <p class="text-sm mt-2">SET: <span id="set-value">0.00</span></p>
    </div>
`)));


Deno.serve(app.fetch);
