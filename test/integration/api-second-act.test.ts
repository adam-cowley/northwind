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
Second-act API surface: edge updates, batch price updates, bulk import,
explain/profile, drift repair, load-test, explorer, NL→Cypher gate.
*/
describe("Northwind Ops API — second act", () => {
	let backend: TestBackend;
	let neode: Neode;
	let app: ReturnType<typeof createApp>;
	let cookie = "";
	let orderId: number;

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
		const placed = await service.placeOrder({
			customerID: "ANTON",
			employeeID: 2,
			shipperID: 1,
			items: [{ productID: 4, quantity: 3, discount: 0.05 }],
		});

		orderId = placed.orderID;
	}, 300000);

	it("exposes line elementIds and updates an edge (NTS-513)", async () => {
		const detail = await app.request(`/api/orders/${orderId}`, {
			headers: { cookie },
		});
		const body = (await detail.json()) as {
			lines: { elementId?: string; line: Record<string, unknown> }[];
		};

		const line = body.lines[0];

		expect(line?.elementId).toBeTruthy();

		const patched = await app.request(
			`/api/order-lines/${encodeURIComponent(line!.elementId!)}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json", cookie },
				body: JSON.stringify({ quantity: 7 }),
			},
		);

		expect(patched.status).toBe(200);

		const updated = (await patched.json()) as { line: { quantity: number } };
		expect(updated.line.quantity).toBe(7);
	});

	it("422s an edge update that violates the line rules (NTS-509 through the API)", async () => {
		const detail = await app.request(`/api/orders/${orderId}`, {
			headers: { cookie },
		});
		const body = (await detail.json()) as { lines: { elementId?: string }[] };

		const patched = await app.request(
			`/api/order-lines/${encodeURIComponent(body.lines[0]!.elementId!)}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json", cookie },
				body: JSON.stringify({ quantity: 0 }),
			},
		);

		expect(patched.status).toBe(422);
	});

	it("updates prices in one all-or-nothing batch (NTS-519)", async () => {
		const before = await neode.readCypher(
			"MATCH (p:Product) WHERE p.productID IN [1, 2] WITH p ORDER BY p.productID RETURN collect(p.unitPrice) AS prices",
			{},
		);

		const response = await app.request("/api/products/price-update", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({
				updates: [
					{ productID: 1, factor: 1.5 },
					{ productID: 2, factor: 0.5 },
				],
			}),
		});

		const body = (await response.json()) as { applied: number };
		expect(response.status).toBe(200);
		expect(body.applied).toBe(2);

		const after = await neode.readCypher(
			"MATCH (p:Product) WHERE p.productID IN [1, 2] WITH p ORDER BY p.productID RETURN collect(p.unitPrice) AS prices",
			{},
		);

		const beforePrices = JSON.parse(
			JSON.stringify(before.records[0]?.get("prices")),
		) as number[];
		const afterPrices = JSON.parse(
			JSON.stringify(after.records[0]?.get("prices")),
		) as number[];

		expect(afterPrices[0]).toBeCloseTo(beforePrices[0]! * 1.5, 0);
		expect(afterPrices[1]).toBeCloseTo(beforePrices[1]! * 0.5, 0);
	});

	it("imports products through the bulk path (NTS-520)", async () => {
		const response = await app.request("/api/products/import", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({
				rows: [
					{
						productID: 9001,
						name: "Imported Ale",
						supplierID: 1,
						unitPrice: 9.5,
						unitsInStock: 10,
						unitsOnOrder: 0,
						reorderLevel: 5,
						discontinued: false,
						quantityPerUnit: "24 bottles",
					},
					{
						productID: 9002,
						name: "Imported Lager",
						supplierID: 1,
						unitPrice: 8,
						unitsInStock: 5,
						unitsOnOrder: 0,
						reorderLevel: 5,
						discontinued: false,
						quantityPerUnit: "24 bottles",
					},
				],
			}),
		});

		const body = (await response.json()) as {
			imported: number;
			chunks: number;
		};

		expect(response.status).toBe(200);
		expect(body.imported).toBe(2);
		expect(body.chunks).toBe(1);

		// Idempotent re-import converges
		const again = await app.request("/api/products/import", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({
				rows: [
					{
						productID: 9001,
						name: "Imported Ale",
						supplierID: 1,
						unitPrice: 9.5,
						unitsInStock: 10,
						unitsOnOrder: 0,
						reorderLevel: 5,
						discontinued: false,
						quantityPerUnit: "24 bottles",
					},
				],
			}),
		});

		expect(again.status).toBe(200);

		const count = await neode.readCypher(
			'MATCH (p:Product {name: "Imported Ale"}) RETURN count(p) AS c',
			{},
		);
		expect(Number(count.records[0]?.get("c"))).toBe(1);
	});

	it("explains a read query and returns a plan (NTS-521)", async () => {
		const response = await app.request(
			`/api/explain?q=${encodeURIComponent("MATCH (p:Product) RETURN p LIMIT 1")}`,
			{ headers: { cookie } },
		);

		expect(response.status).toBe(200);
	});

	it("profiles a read query (NTS-521)", async () => {
		const response = await app.request("/api/profile", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ cypher: "MATCH (p:Product) RETURN count(p)" }),
		});

		expect(response.status).toBe(200);
	});

	it("repairs schema drift (NTS-522)", async () => {
		const response = await app.request("/api/schema/repair", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({}),
		});

		const body = (await response.json()) as { report: string };

		expect(response.status).toBe(200);
		expect(typeof body.report).toBe("string");
	});

	it("runs the load-test panel (NTS-518)", async () => {
		const before = await neode.readCypher(
			"MATCH (o:Order) RETURN count(o) AS c",
			{},
		);

		const response = await app.request("/api/load-test", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ count: 25 }),
		});

		const body = (await response.json()) as { count: number; ms: number };

		expect(response.status).toBe(200);
		expect(body.count).toBe(25);
		expect(body.ms).toBeGreaterThanOrEqual(0);

		const after = await neode.readCypher(
			"MATCH (o:Order) RETURN count(o) AS c",
			{},
		);

		expect(Number(after.records[0]?.get("c"))).toBe(
			Number(before.records[0]?.get("c")) + 25,
		);
	});

	it("explores a 1-hop neighbourhood (NTS-517)", async () => {
		const response = await app.request(
			"/api/explore?type=Product&pk=productID&id=1",
			{ headers: { cookie } },
		);
		const body = (await response.json()) as {
			center: Record<string, unknown>;
			edges: { rel: Record<string, unknown>; node: Record<string, unknown> }[];
		};

		expect(response.status).toBe(200);
		expect(body.edges.length).toBeGreaterThan(0);
	});

	it("gates NL→Cypher behind the key (NTS-524)", async () => {
		const response = await app.request("/api/ask", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ question: "top products" }),
		});

		// No NW_LLM_URL/NW_LLM_KEY in the test env
		expect(response.status).toBe(501);
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});

describe("product drill-in (co-purchase, companies, sales-over-time)", () => {
	let backend: TestBackend;
	let app: ReturnType<typeof createApp>;
	let cookie = "";

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

		const loginResponse = await app.request("/login", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: "user=admin&password=northwind",
		});

		cookie =
			(loginResponse.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
	}, 300000);

	it("reports monthly sales for a product", async () => {
		const response = await app.request("/api/products/1/sales-over-time", {
			headers: { cookie },
		});

		const body = (await response.json()) as {
			month: string;
			orders: number;
			revenue: number;
		}[];

		expect(response.status).toBe(200);
		expect(body.length).toBeGreaterThan(10);
		expect(body[0]?.month).toMatch(/^\d{4}-\d{2}$/);
		expect(body.every((row) => row.orders > 0)).toBe(true);
	});

	it("ranks the top companies ordering the product", async () => {
		const response = await app.request("/api/products/1/companies", {
			headers: { cookie },
		});
		const body = (await response.json()) as {
			company: string;
			orders: number;
			revenue: number;
		}[];

		expect(response.status).toBe(200);
		expect(body.length).toBeGreaterThan(2);
		expect(body[0]?.revenue).toBeGreaterThanOrEqual(body[1]?.revenue ?? 0);
	});

	it("recommends co-purchased products (people who bought A also bought B)", async () => {
		const response = await app.request("/api/products/1/also-bought", {
			headers: { cookie },
		});
		const body = (await response.json()) as {
			productID: number;
			name: string;
			times: number;
		}[];

		expect(response.status).toBe(200);
		expect(body.length).toBeGreaterThan(2);
		expect(body.every((row) => row.productID !== 1)).toBe(true);
		expect(body[0]?.times).toBeGreaterThanOrEqual(body[1]?.times ?? 0);
	});
});
