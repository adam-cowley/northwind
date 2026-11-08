import { beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { OrderRepository } from "../../src/repositories/order-repository.js";
import { ProductRepository } from "../../src/repositories/product-repository.js";
import { CustomerRepository } from "../../src/repositories/customer-repository.js";
import { NorthwindService } from "../../src/services/northwind-service.js";
import { createApp } from "../../src/api/app.js";
import Neode from "neode";
import { Product, Order, Customer } from "../../src/models/index.js";

/**
Auth: the whole surface sits behind the signed session cookie; the login
page is the only open route (besides /api/health).
*/
describe("auth", () => {
	let backend: TestBackend;
	let app: ReturnType<typeof createApp>;

	function cookieOf(response: Response): string {
		const setCookie = response.headers.get("set-cookie") ?? "";

		return setCookie.split(";")[0] ?? "";
	}

	beforeAll(async () => {
		backend = await openBackend();
		await seed(backend.neode);

		const service = new NorthwindService(
			backend.neode,
			new ProductRepository(backend.neode, Product),
			new OrderRepository(backend.neode, Order),
			new CustomerRepository(backend.neode, Customer),
		);

		app = createApp(backend.neode, service);
	}, 300000);

	it("the API is closed without a session", async () => {
		const response = await app.request("/api/catalog");

		expect(response.status).toBe(401);
	});

	it("the health check stays open (uptime probes)", async () => {
		const response = await app.request("/api/health");

		expect(response.status).toBe(200);
	});

	it("the login page serves and rejects wrong credentials", async () => {
		const page = await app.request("/login");

		expect(page.status).toBe(200);
		expect(await page.text()).toContain("Northwind Ops");

		const bad = await app.request("/login", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: "user=admin&password=wrong",
		});

		expect(bad.status).toBe(401);
	});

	it("issues a signed session on good credentials; tampered cookies bounce", async () => {
		const loginResponse = await app.request("/login", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: "user=admin&password=northwind",
		});

		expect(loginResponse.status).toBe(302); // → /

		const cookie = cookieOf(loginResponse);

		expect(cookie).toContain("nw_session=");

		const authed = await app.request("/api/catalog?page=1&limit=1", {
			headers: { cookie },
		});

		expect(authed.status).toBe(200);

		const tampered = await app.request("/api/catalog", {
			headers: { cookie: `${cookie}x` },
		});

		expect(tampered.status).toBe(401);
	});

	it("logout clears the session", async () => {
		const loginResponse = await app.request("/login", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: "user=admin&password=northwind",
		});

		const cookie = cookieOf(loginResponse);

		const out = await app.request("/logout", {
			method: "POST",
			headers: { cookie },
		});

		const cleared = await app.request("/api/catalog", {
			headers: { cookie: cookieOf(out) },
		});

		expect(cleared.status).toBe(401);
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});
