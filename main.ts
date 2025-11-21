// main.ts
import { Hono } from "hono/mod.ts";
import { upgradeWebSocket } from "std/http/server.ts";
import { hash, compare } from "bcrypt";
import { create, verify } from "djwt";

// --- Configuration ---
// Change this secret key in production! Use an environment variable.
const JWT_SECRET = Deno.env.get("JWT_SECRET") || "your-ultra-secure-secret-key"; 

// --- Types for KV Data ---
interface User {
    id: string;
    username: string;
    passwordHash: string; // Hashed password
    credit: number;
    isAdmin: boolean;
}

interface JWTPayload {
    id: string;
    username: string;
    isAdmin: boolean;
}

// --- KV Initialization ---
const kv = await Deno.openKv();

// --- WebSocket Setup (Same as before) ---
const clients = new Set<WebSocket>();

function handleWebSocket(request: Request): Response {
    const { socket, response } = upgradeWebSocket(request);

    socket.onopen = () => {
        console.log("A new client connected to WebSocket.");
        clients.add(socket);
        socket.send(JSON.stringify({ type: "INFO", message: "Connected to 2D Live Results." }));
    };

    socket.onclose = () => {
        console.log("Client disconnected.");
        clients.delete(socket);
    };

    socket.onerror = (e) => {
        console.error("WebSocket error:", e);
    };

    return response;
}

async function broadcastResult(result: string) {
    const message = JSON.stringify({ type: "RESULT", data: result, timestamp: new Date().toISOString() });
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
    console.log(`Broadcasted result: ${result} to ${clients.size} clients.`);
}

// --- JWT Middleware (Protecting routes) ---
const jwtAuth = async (c, next) => {
    const authHeader = c.req.header("Authorization");
    const token = authHeader?.split(" ")[1];

    if (!token) {
        return c.json({ error: "Unauthorized. Missing token." }, 401);
    }

    try {
        const payload = await verify(token, JWT_SECRET, "HS512") as JWTPayload;
        // Attach user info to the context for next routes
        c.set("user", payload);
        await next();
    } catch (e) {
        console.error("JWT verification failed:", e);
        return c.json({ error: "Unauthorized. Invalid token." }, 401);
    }
};

const adminAuth = async (c, next) => {
    const user = c.get("user") as JWTPayload;
    if (!user || !user.isAdmin) {
        return c.json({ error: "Forbidden. Admin access required." }, 403);
    }
    await next();
};


// --- Hono App Initialization ---
const app = new Hono();

// --- Auth Routes ---
app.post("/api/auth/register", async (c) => {
    const { username, password } = await c.req.json();
    if (!username || !password || username.length < 3 || password.length < 6) {
        return c.json({ error: "Invalid username or password format." }, 400);
    }

    const usernameKey = ["users_by_username", username];
    const existingUser = await kv.get(usernameKey);

    if (existingUser.value) {
        return c.json({ error: "Username already exists." }, 409);
    }

    const passwordHash = await hash(password);
    const userId = crypto.randomUUID();
    const isFirstUser = (await kv.list({ prefix: ["users"] }).next()).done; 

    const newUser: User = { 
        id: userId, 
        username, 
        passwordHash, 
        credit: 0, 
        // Auto-set the first registered user as Admin for easy setup
        isAdmin: isFirstUser 
    };

    // Store user by ID and by username for quick lookups
    await kv.set(["users", userId], newUser);
    await kv.set(usernameKey, { id: userId }); 

    return c.json({ message: "Registration successful. You can now log in." });
});

app.post("/api/auth/login", async (c) => {
    const { username, password } = await c.req.json();
    if (!username || !password) {
        return c.json({ error: "Missing username or password." }, 400);
    }

    const usernameEntry = await kv.get<{ id: string }>(["users_by_username", username]);
    if (!usernameEntry.value) {
        return c.json({ error: "Invalid credentials." }, 401);
    }

    const userEntry = await kv.get<User>(["users", usernameEntry.value.id]);
    const user = userEntry.value;

    if (!user || !(await compare(password, user.passwordHash))) {
        return c.json({ error: "Invalid credentials." }, 401);
    }

    // Create JWT Token
    const payload: JWTPayload = { id: user.id, username: user.username, isAdmin: user.isAdmin };
    const token = await create({ alg: "HS512", typ: "JWT" }, payload, JWT_SECRET);

    return c.json({ token, user: { id: user.id, username: user.username, credit: user.credit, isAdmin: user.isAdmin } });
});

// --- Admin/Credit Routes ---
const admin = new Hono();
admin.use("*", jwtAuth, adminAuth); // Apply JWT check and Admin check to all admin routes

// Admin fills credit to a user (Crucial for your app)
admin.post("/fill-credit", async (c) => {
    const { username, amount } = await c.req.json();
    if (!username || typeof amount !== 'number' || amount <= 0) {
        return c.json({ error: "Invalid data or amount." }, 400);
    }

    const usernameEntry = await kv.get<{ id: string }>(["users_by_username", username]);
    if (!usernameEntry.value) {
        return c.json({ error: "User not found." }, 404);
    }

    const userId = usernameEntry.value.id;
    const key = ["users", userId];
    
    // Transaction to safely update credit
    const result = await kv.atomic()
        .mutate({ type: "sum", key: key, value: { credit: amount } })
        .commit();

    if (result.ok) {
        const updatedEntry = await kv.get<User>(key);
        return c.json({ 
            message: "Credit successfully filled.", 
            user: { username: updatedEntry.value?.username, credit: updatedEntry.value?.credit }
        });
    }

    return c.json({ error: "Failed to fill credit (KV error)." }, 500);
});

// Admin broadcasts a test result (For live 2D)
admin.post("/broadcast-test", async (c) => {
    const testResult = (Math.floor(Math.random() * 99) + 1).toString().padStart(2, '0');
    await broadcastResult(testResult);
    return c.json({ status: "Success", broadcasted: testResult });
});

app.route("/api/admin", admin); // Attach admin routes

// --- Protected User Routes (Example: Get own credit) ---
app.get("/api/user/me", jwtAuth, async (c) => {
    const userPayload = c.get("user") as JWTPayload;
    const userEntry = await kv.get<User>(["users", userPayload.id]);

    if (!userEntry.value) {
        return c.json({ error: "User data not found." }, 404);
    }
    const { username, credit, isAdmin } = userEntry.value;
    return c.json({ id: userPayload.id, username, credit, isAdmin });
});

// --- WebSocket & Basic HTML (Same as before) ---
app.get("/ws/live-result", (c) => handleWebSocket(c.req.raw));

app.get("/", (c) => {
    return c.html(`
        <!DOCTYPE html>
        <html lang="en">
        <head><title>2D Deno KV Auth</title></head>
        <body>
            <h1>2D Server Ready (Deno KV & JWT)</h1>
            <p>Test with /api/auth/register and /api/auth/login routes.</p>
            <p>Admin functions are under /api/admin/fill-credit.</p>
        </body>
        </html>
    `);
});

// --- Server Export for Deno Deploy ---
Deno.serve(app.fetch);
