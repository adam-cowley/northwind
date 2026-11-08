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
API e2e: the Hono app is driven through app.request() — no network.
*/
describe("Northwind Ops API (e2e via app.request)", () => {
	let backend: TestBackend;
	let neode: Neode;
	let app: ReturnType<typeof createApp>;
	let cookie = "";

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

	it("serves the paginated catalog with projected fields", async () => {
		const response = await app.request("/api/catalog?page=1&limit=5", {
			headers: { cookie },
		});
		const body = (await response.json()) as {
			total: number;
			items: {
				productID: number;
				supplier?: { companyName: string };
				category?: string;
				orderCount: number;
			}[];
		};

		expect(response.status).toBe(200);
		expect(body.total).toBe(77);
		expect(body.items).toHaveLength(5);
		expect(body.items[0]?.supplier?.companyName).toBeTruthy();
		expect(typeof body.items[0]?.orderCount).toBe("number");
	});

	it("serves product detail with kNN neighbours", async () => {
		const response = await app.request("/api/products/4", {
			headers: { cookie },
		});
		const body = (await response.json()) as {
			product: { productID: number };
			similar: unknown[];
		};

		expect(response.status).toBe(200);
		expect(body.product.productID).toBe(4);
		expect(body.similar.length).toBeGreaterThan(0);
	});

	it("404s a missing product", async () => {
		const response = await app.request("/api/products/99999", {
			headers: { cookie },
		});

		expect(response.status).toBe(404);
	});

	it("serves the customer profile: customer without orders + separate history (NTS-560)", async () => {
		const response = await app.request("/api/customers/ANTON", {
			headers: { cookie },
		});
		const body = (await response.json()) as {
			customer: Record<string, unknown> & { customerID: string };
			history: Record<string, unknown>[];
		};

		expect(response.status).toBe(200);
		expect(body.customer.customerID).toBe("ANTON");
		// The load spec's orders do not leak into the customer payload —
		// the wire shape keeps { customer, history }
		expect(Object.hasOwn(body.customer, "orders")).toBe(false);
		expect(Array.isArray(body.history)).toBe(true);
		expect(body.history.length).toBeGreaterThan(0);
		expect(body.history.length).toBeLessThanOrEqual(25);
	});

	it("400s a missing customer (the not-found NeodeError maps through)", async () => {
		const response = await app.request("/api/customers/ZZZZZ", {
			headers: { cookie },
		});

		expect(response.status).toBe(400);
	});

	it("places an order over the API (201) and decrements stock", async () => {
		const before = await neode.readCypher(
			"MATCH (p:Product { productID: 4 }) RETURN p.unitsInStock AS stock",
			{},
		);
		const stockBefore = Number(before.records[0]?.get("stock"));

		const response = await app.request("/api/orders", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({
				customerID: "ANTON",
				employeeID: 2,
				shipperID: 1,
				items: [{ productID: 4, quantity: 2 }],
			}),
		});

		expect(response.status).toBe(201);

		const after = await neode.readCypher(
			"MATCH (p:Product { productID: 4 }) RETURN p.unitsInStock AS stock",
			{},
		);

		expect(Number(after.records[0]?.get("stock"))).toBe(stockBefore - 2);
	});

	it("coalesces an omitted discount to 0 on the placed lines (NTS-557)", async () => {
		const response = await app.request("/api/orders", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({
				customerID: "ANTON",
				employeeID: 2,
				shipperID: 1,
				items: [{ productID: 11, quantity: 2 }],
			}),
		});

		expect(response.status).toBe(201);

		const placed = (await response.json()) as { orderID: number };

		// The edge stores 0, not null — a null discount would zero the
		// line's revenue in every 1 - discount projection
		const edge = await neode.readCypher(
			"MATCH (:Order { orderID: $id })-[line:CONTAINS]->(:Product { productID: 11 }) RETURN line.discount AS discount",
			{ id: placed.orderID },
		);

		expect(edge.records[0]?.get("discount")).toBe(0);

		// …so the line's revenue shows up on the growth board's current month
		const growth = await app.request("/api/insight/growth?limit=10", {
			headers: { cookie },
		});
		const body = (await growth.json()) as {
			risers: { productID: number; revenue: number }[];
		};

		const riser = body.risers.find((row) => row.productID === 11);

		expect(riser?.revenue).toBeGreaterThan(0);
	});

	it("409s an out-of-stock order", async () => {
		const response = await app.request("/api/orders", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({
				customerID: "ANTON",
				employeeID: 2,
				shipperID: 1,
				items: [{ productID: 4, quantity: 999999 }],
			}),
		});

		expect(response.status).toBe(409);
	});

	it("422s invalid order lines (quantity below the schema minimum)", async () => {
		const response = await app.request("/api/orders", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({
				customerID: "ANTON",
				employeeID: 2,
				shipperID: 1,
				items: [{ productID: 4, quantity: 0 }],
			}),
		});

		expect(response.status).toBe(422);
	});

	it("409s a duplicate customer (constraint violation → typed conflict)", async () => {
		const create = await app.request("/api/customers", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({
				customerID: "ZZTOP",
				companyName: "ZZ Top Records",
			}),
		});

		expect(create.status).toBe(201);

		const duplicate = await app.request("/api/customers", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({
				customerID: "ZZTOP",
				companyName: "ZZ Top Records",
			}),
		});

		expect(duplicate.status).toBe(409);
	});

	it("runs the read-only console and reports the query inspector", async () => {
		const response = await app.request("/api/console", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({
				cypher: "MATCH (p:Product) RETURN p.name AS name LIMIT 3",
			}),
		});

		const body = (await response.json()) as {
			columns: string[];
			rows: unknown[][];
		};

		expect(response.status).toBe(200);
		expect(body.columns).toEqual(["name"]);
		expect(body.rows).toHaveLength(3);

		const inspector = await app.request("/api/inspector", {
			headers: { cookie },
		});
		const statements = (await inspector.json()) as { statements: unknown[] };

		expect(statements.statements.length).toBeGreaterThan(0);
	});

	it("serves the ontology and the schema drift report", async () => {
		const ontology = await app.request("/api/ontology", {
			headers: { cookie },
		});
		const text = await ontology.text();

		expect(ontology.status).toBe(200);
		expect(text).toContain("Product");

		const schema = await app.request("/api/schema", { headers: { cookie } });
		const body = (await schema.json()) as { drift: string };

		expect(schema.status).toBe(200);
		expect(typeof body.drift).toBe("string");
	});

	it("serves suppliers-near (withinDistance) and analytics", async () => {
		const near = await app.request(
			"/api/suppliers/near?lat=51.51&lon=-0.13&radius=800",
			{ headers: { cookie } },
		);
		const { suppliers } = (await near.json()) as { suppliers: unknown[] };

		expect(near.status).toBe(200);
		expect(suppliers.length).toBeGreaterThan(0);

		const revenue = await app.request("/api/analytics/revenue-by-country", {
			headers: { cookie },
		});
		const body = (await revenue.json()) as { revenue: number }[];

		expect(revenue.status).toBe(200);
		expect(body[0]?.revenue).toBeGreaterThan(0);
	});

	it("falls back to the default page for a garbage ?limit (NTS-556 intQuery)", async () => {
		const response = await app.request("/api/catalog?limit=abc", {
			headers: { cookie },
		});
		const body = (await response.json()) as { items: unknown[] };

		expect(response.status).toBe(200);
		expect(body.items).toHaveLength(12);
	});

	it("serves a mounted insight route and the entity route (NTS-556 registry)", async () => {
		const growth = await app.request("/api/insight/growth?limit=3", {
			headers: { cookie },
		});
		const growthBody = (await growth.json()) as {
			month: string | null;
			risers: unknown[];
			fallers: unknown[];
		};

		// Mount coverage only — the growth math has its own suite
		// (including the omitted-discount coalesce, NTS-557).
		expect(growth.status).toBe(200);
		expect(growthBody.month).toMatch(/^\d{4}-\d{2}$/);
		expect(Array.isArray(growthBody.risers)).toBe(true);
		expect(Array.isArray(growthBody.fallers)).toBe(true);

		const entity = await app.request("/api/entity/Product/1", {
			headers: { cookie },
		});
		const entityBody = (await entity.json()) as { type: string; id: number };

		expect(entity.status).toBe(200);
		expect(entityBody.type).toBe("Product");
		expect(entityBody.id).toBe(1);
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});
