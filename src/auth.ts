import { createHmac, timingSafeEqual } from "node:crypto";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";

/**
Demo auth (the "auth" gap, closed simply): env credentials, HMAC-signed
cookie sessions, no session store. The whole surface — pages and API —
sits behind the guard except the login page and the health check.

- NW_AUTH_USER / NW_AUTH_PASSWORD (default admin / northwind)
- NW_AUTH_SECRET signs the cookie (default warns loudly in the log)
*/

const SESSION_COOKIE = "nw_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Read once: the env does not change mid-process, and the missing-secret
// warning must fire once at boot, not on every authenticated request.
const CREDENTIALS = ((): { user: string; password: string; secret: string } => {
	const user = process.env["NW_AUTH_USER"] ?? "admin";
	const password = process.env["NW_AUTH_PASSWORD"] ?? "northwind";
	const secret = process.env["NW_AUTH_SECRET"];

	if (secret === undefined) {
		console.warn(
			"NW_AUTH_SECRET not set — using the demo default. Set it in production.",
		);
	}

	return { user, password, secret: secret ?? "northwind-demo-secret" };
})();

export function authCredentials(): {
	user: string;
	password: string;
	secret: string;
} {
	return CREDENTIALS;
}

function sign(payload: string, secret: string): string {
	return createHmac("sha256", secret).update(payload).digest("base64url");
}

function issueToken(user: string, secret: string): string {
	const payload = Buffer.from(
		JSON.stringify({ u: user, exp: Date.now() + SESSION_TTL_MS }),
	).toString("base64url");

	return `${payload}.${sign(payload, secret)}`;
}

function verifyToken(
	token: string | undefined,
	secret: string,
): string | undefined {
	if (token === undefined) {
		return undefined;
	}

	const [payload, signature] = token.split(".");

	if (payload === undefined || signature === undefined) {
		return undefined;
	}

	const expected = sign(payload, secret);

	const ok =
		signature.length === expected.length &&
		timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

	if (!ok) {
		return undefined;
	}

	try {
		const decoded = JSON.parse(
			Buffer.from(payload, "base64url").toString(),
		) as { u?: string; exp?: number };

		if (
			decoded.exp === undefined ||
			decoded.exp < Date.now() ||
			decoded.u === undefined
		) {
			return undefined;
		}

		return decoded.u;
	} catch {
		return undefined;
	}
}

/** The signed session's user, or undefined — the guard middleware decides the response. */
export function currentUser(context: Context): string | undefined {
	const { secret } = authCredentials();

	return verifyToken(getCookie(context, SESSION_COOKIE), secret);
}

export function login(
	context: Context,
	user: string,
	password: string,
): boolean {
	const expected = authCredentials();

	// Constant-time-ish compares for both fields
	const userOk = safeEquals(user, expected.user);
	const passwordOk = safeEquals(password, expected.password);

	if (!userOk || !passwordOk) {
		return false;
	}

	setCookie(
		context,
		SESSION_COOKIE,
		issueToken(expected.user, expected.secret),
		{
			httpOnly: true,
			sameSite: "Lax",
			path: "/",
			maxAge: SESSION_TTL_MS / 1000,
		},
	);

	return true;
}

export function logout(context: Context): void {
	deleteCookie(context, SESSION_COOKIE, { path: "/" });
}

function safeEquals(given: string, expected: string): boolean {
	const a = Buffer.from(given);
	const b = Buffer.from(expected);

	return a.length === b.length && timingSafeEqual(a, b);
}

/** The minimal server-rendered login page — no SPA needed to authenticate. */
export function loginPage(error = ""): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Northwind Ops — sign in</title>
<style>
  body { margin: 0; background: #0d1117; color: #e6edf3; font: 14px/1.5 ui-monospace, Menlo, monospace;
         display: grid; place-items: center; min-height: 100vh; }
  form { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 28px 32px; width: 320px; }
  .logo { color: #f7b32b; font-weight: 700; margin-bottom: 18px; font-size: 16px; }
  input { width: 100%; margin: 6px 0 12px; background: #0d1117; color: #e6edf3;
          border: 1px solid #30363d; border-radius: 6px; padding: 8px 10px; font: inherit; box-sizing: border-box; }
  button { width: 100%; background: #f7b32b; color: #000; border: 0; border-radius: 6px;
           padding: 9px; font: inherit; font-weight: 700; cursor: pointer; }
  .error { color: #f85149; margin-bottom: 10px; }
  .hint { color: #8b949e; font-size: 12px; margin-top: 14px; }
</style>
</head>
<body>
<form method="post" action="/login">
  <div class="logo">🌬️ Northwind Ops</div>
  ${error !== "" ? `<div class="error">${error}</div>` : ""}
  <label>user<input name="user" autocomplete="username" autofocus></label>
  <label>password<input name="password" type="password" autocomplete="current-password"></label>
  <button>Sign in</button>
  <div class="hint">demo credentials: admin / northwind (override NW_AUTH_USER / NW_AUTH_PASSWORD)</div>
</form>
</body>
</html>`;
}
