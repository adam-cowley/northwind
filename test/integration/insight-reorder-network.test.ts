import { beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { createReorderNetworkRoutes } from "../../src/features/reorder-network.js";
import Neode from "neode";

/**
NTS-538 — the reorder network insight: two Builder queries (low-stock
products + open-order counts) joined into supplier call-cards; hit the
route handlers with a live Neode instance.
*/
describe("reorder network (NTS-538)", () => {
	let backend: TestBackend;
	let neode: Neode;
	let routes: ReturnType<typeof createReorderNetworkRoutes>;

	beforeAll(async () => {
		backend = await openBackend();
		neode = backend.neode;
		await seed(neode);

		routes = createReorderNetworkRoutes(neode);
	}, 300000);

	it("groups every low-stock product under its supplier", async () => {
		const response = await routes.request("/reorder-network");

		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			suppliers: {
				supplierID: number;
				company: string;
				phone: string;
				country: string;
				products: {
					productID: number;
					stock: number;
					reorderLevel: number;
					openOrders: number;
				}[];
			}[];
		};

		expect(body.suppliers.length).toBeGreaterThanOrEqual(1);

		const seenSuppliers = new Set<number>();
		for (const supplier of body.suppliers) {
			// Grouping is by supplier: each appears once, none empty
			expect(seenSuppliers.has(supplier.supplierID)).toBe(false);
			expect(supplier.products.length).toBeGreaterThan(0);
			seenSuppliers.add(supplier.supplierID);

			for (const product of supplier.products) {
				expect(product.stock).toBeLessThanOrEqual(product.reorderLevel);
				expect(product.openOrders).toBeGreaterThanOrEqual(0);
			}
		}
	});

	it("runs as two statements: the low-stock list and the open counts", async () => {
		const statements: string[] = [];
		neode.on(
			"query:executed" as never,
			((event: { cypher: string }) => {
				statements.push(event.cypher);
			}) as never,
		);

		const response = await routes.request("/reorder-network");
		expect(response.status).toBe(200);

		const lowStock = statements.filter((statement) =>
			statement.includes("reorderLevel"),
		);
		const openCounts = statements.filter((statement) =>
			statement.includes("shippedDate"),
		);

		expect(lowStock).toHaveLength(1);
		expect(lowStock[0]).toContain("SUPPLIED_BY");
		expect(openCounts).toHaveLength(1);
		expect(openCounts[0]).toContain("CONTAINS");
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});
