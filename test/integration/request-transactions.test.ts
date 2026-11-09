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
Request-scoped ambient transactions (NTS-156): every write request runs
in one transaction — the service/repository calls inside join it, the
transaction commits with the response and rolls back on a throw.
*/
describe("Request-scoped ambient transactions", () => {
	let backend: TestBackend;
	let neode: Neode;
	let app: ReturnType<typeof createApp>;
	let service: NorthwindService;
	let cookie = "";
	let orderId: number;

	beforeAll(async () => {
		backend = await openBackend();
		neode = backend.neode;
		await seed(neode);

		service = new NorthwindService(
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

		const placed = await service.placeOrder({
			customerID: "ANTON",
			employeeID: 2,
			shipperID: 1,
			items: [{ productID: 4, quantity: 3, discount: 0.05 }],
		});

		orderId = placed.orderID;
	}, 300000);

	it("commits the request transaction: discontinue persists", async () => {
		const response = await app.request("/api/products/4/discontinue", {
			method: "POST",
			headers: { cookie },
		});

		expect(response.status).toBe(200);

		const body = (await response.json()) as { discontinued: boolean };
		expect(body.discontinued).toBe(true);

		// The request tx committed with the response — a follow-up
		// request (its own tx) reads the flag back
		const detail = await app.request("/api/products/4", {
			headers: { cookie },
		});
		const { product } = (await detail.json()) as {
			product: { discontinued: boolean };
		};

		expect(product.discontinued).toBe(true);
	});

	it("maps a thrown write through the tx rollback to its HTTP status", async () => {
		const response = await app.request(`/api/orders/${orderId}/lines`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ productID: 4, quantity: 999999 }),
		});

		const body = (await response.json()) as { error: string; message?: string };

		expect(response.status).toBe(409);
		expect(body.error).toBe("conflict");
	});

	it("isolates concurrent requests: one failing rolls back only its own scope", async () => {
		const product = await service.products.find(5);
		const stockBefore = product?.unitsInStock ?? 0;

		const orderBefore = await app.request(`/api/orders/${orderId}`, {
			headers: { cookie },
		});
		const { lines } = (await orderBefore.json()) as { lines: unknown[] };

		// Two overlapping requests, disjoint work (different products —
		// no row contention): one commits, one fails. ALS keeps each
		// request's ambient transaction in its own async context — if the
		// scopes ever leaked into one another, the failing request would
		// drag the committed one back with it.
		const [restocked, rejected] = await Promise.all([
			app.request("/api/products/5/restock", {
				method: "POST",
				headers: { "content-type": "application/json", cookie },
				body: JSON.stringify({ by: 7 }),
			}),
			app.request(`/api/orders/${orderId}/lines`, {
				method: "POST",
				headers: { "content-type": "application/json", cookie },
				body: JSON.stringify({ productID: 6, quantity: 999999 }),
			}),
		]);

		expect(rejected.status).toBe(409);
		expect(restocked.status).toBe(200);

		// The successful request's write persisted — its tx committed
		// with its response, untouched by its neighbour's rollback
		const { unitsInStock } = (await restocked.json()) as {
			unitsInStock: number;
		};
		expect(unitsInStock).toBe(stockBefore + 7);

		// The failing request's scope rolled back — no line leaked onto
		// the order its neighbour shares the process with
		const orderAfter = await app.request(`/api/orders/${orderId}`, {
			headers: { cookie },
		});
		const { lines: after } = (await orderAfter.json()) as {
			lines: unknown[];
		};
		expect(after).toHaveLength(lines.length);
	});

	it("update(id, patch) resolves undefined for a missing product", async () => {
		const product = await service.products.update(99999, {
			discontinued: true,
		});

		expect(product).toBeUndefined();
	});
});
