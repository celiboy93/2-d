export const kv = await Deno.openKv();

// --- USER TYPES (Basic) ---
export interface User {
  username: string;
  password: string;
  balance: number;
  isAdmin: boolean;
}

// --- 2D TYPES ---
export interface TwoDResult {
    date: string; // YYYY-MM-DD
    time: string; // 12:01 PM or 4:30 PM
    set: string;
    value: string;
    twod: string;
}

export interface TwoDBet {
    id: string;
    username: string;
    number: string;
    amount: number;
    session: "Morning" | "Evening";
    status: "pending" | "win" | "lose";
    timestamp: number;
}

// --- CONFIGURATION ---
export async function getConfig() {
    const manual2d = await kv.get<string>(["config", "manual_2d"]);
    return { manual2d: manual2d.value || "" };
}

// --- DB ACCESS FUNCTIONS (Need to be implemented later) ---
export async function getUser(username: string) { return (await kv.get<User>(["users", username])).value; }
export async function updateUser(user: User) { await kv.set(["users", user.username], user); }
export async function hashPassword(password: string) {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(password + "my-2d-salt"));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function save2DResult(res: TwoDResult) { await kv.set(["2d_results", res.date, res.time], res); }
export async function placeBet(username: string, number: string, amount: number, session: "Morning" | "Evening") { 
    const id = crypto.randomUUID();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Yangon" });
    const bet: TwoDBet = { id, username, number, amount, date: today, session, status: "pending", timestamp: Date.now() };
    await kv.set(["2d_bets", today, username, id], bet);
    return bet;
}
