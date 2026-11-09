import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { ProductRepository } from "../../src/repositories/product-repository.js";
import { OrderRepository } from "../../src/repositories/order-repository.js";
import { CustomerRepository } from "../../src/repositories/customer-repository.js";
import { NorthwindService } from "../../src/services/northwind-service.js";
import { createApp } from "../../src/api/app.js";
import Neode from "neode";
import { Product, Order, Customer } from "../../src/models/index.js";

/**
Vector rename regression (NTS-440): renaming a product through the API
must recompute the @Vector embedding from the new name on save, so the
kNN search over the NEW name text finds the product.
*/
describe("Northwind Ops API — vector rename (NTS-440)", () => {
	let backend: TestBackend;
	let neode: Neode;
	let app: ReturnType<typeof createApp>;
	let cookie = "";

	// A token no seeded product name shares: the renamed product's own
	// embedding is the only one carrying it, so the kNN top hit decides
	const NEW_NAME = "Qxzzy Sprocket Renamed";

	beforeAll(async () => {
		backend = await openBackend();
		neode = backend.neode;
		await seed(neode);

		const service = new NorthwindService(
			neode,
			new ProductRepository(neode, Product),
			new OrderRepository(neode, Order),
			new CustomerRepository(neode, Customer),
		);

		app = createApp(neode, service);

		const loginResponse = await app.request("/login", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: "user=admin&password=northwind",
		});

		cookie =
			(loginResponse.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
	}, 300000);

	afterAll(async () => {
		await backend.close();
	});

	it("recomputes the embedding on rename, so kNN over the new name finds the product", async () => {
		const renamed = await app.request("/api/products/4", {
			method: "PUT",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ name: NEW_NAME }),
		});

		expect(renamed.status).toBe(200);
		expect(((await renamed.json()) as { name: string }).name).toBe(NEW_NAME);

		const search = await app.request(
			`/api/search?q=${encodeURIComponent(NEW_NAME)}`,
			{ headers: { cookie } },
		);
		const body = (await search.json()) as {
			similar: { score: number; product: { productID: number } }[];
		};

		expect(body.similar.length).toBeGreaterThan(0);
		expect(body.similar[0]?.product.productID).toBe(4);
	});
});
