import { beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { createSupplyExposureRoutes } from "../../src/features/supply-exposure.js";
import Neode from "neode";

/**
NTS-532 — supply-chain exposure insight, hit through the mounted
sub-app's route handlers with a live Neode instance over the seeded graph.
*/
describe("supply-chain exposure (NTS-532)", () => {
	let backend: TestBackend;
	let neode: Neode;
	let routes: ReturnType<typeof createSupplyExposureRoutes>;

	beforeAll(async () => {
		backend = await openBackend();
		neode = backend.neode;
		await seed(neode);

		routes = createSupplyExposureRoutes(neode);
	}, 300000);

	it("ranks every seeded supplier by exposure, most-dependent first", async () => {
		const response = await routes.request("/supply-exposure");

		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			suppliers: {
				id: number;
				company: string;
				country: string;
				products: number;
				orders: number;
				customers: number;
			}[];
		};

		// The Northwind dataset ships 29 suppliers, all with ordered products
		expect(body.suppliers).toHaveLength(29);

		for (const [index, supplier] of body.suppliers.entries()) {
			expect(supplier.products).toBeGreaterThan(0);
			expect(supplier.orders).toBeGreaterThan(0);
			expect(supplier.customers).toBeGreaterThan(0);

			if (index > 0) {
				const previous = body.suppliers[index - 1] as {
					customers: number;
					orders: number;
				};

				// Primary: distinct customers; tiebreak: distinct orders
				expect(previous.customers).toBeGreaterThanOrEqual(supplier.customers);

				if (previous.customers === supplier.customers) {
					expect(previous.orders).toBeGreaterThanOrEqual(supplier.orders);
				}
			}
		}
	});

	it("drills into the most-exposed supplier: contact, products, affected customers", async () => {
		const ranking = await routes.request("/supply-exposure");
		const rankingBody = (await ranking.json()) as {
			suppliers: {
				id: number;
				company: string;
				products: number;
				orders: number;
				customers: number;
			}[];
		};
		const top = rankingBody.suppliers[0] as {
			id: number;
			company: string;
			products: number;
			orders: number;
			customers: number;
		};

		const response = await routes.request(`/supply-exposure/${top.id}`);

		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			supplier: {
				id: number;
				company: string;
				contactName: string;
				country: string;
			};
			products: { id: number; name: string; stock: number }[];
			orders: number;
			customers: { id: string; company: string; country: string }[];
		};

		// Counts agree with the ranking row
		expect(body.supplier.id).toBe(top.id);
		expect(body.supplier.company).toBe(top.company);
		expect(body.supplier.contactName).not.toBe("");
		expect(body.supplier.country).not.toBe("");
		expect(body.products).toHaveLength(top.products);
		expect(body.orders).toBe(top.orders);
		expect(body.customers).toHaveLength(top.customers);

		// Products and customers are distinct lists
		const productIds = body.products.map((product) => product.id);
		expect(new Set(productIds).size).toBe(productIds.length);

		const customerIds = body.customers.map((customer) => customer.id);
		expect(new Set(customerIds).size).toBe(customerIds.length);

		for (const customer of body.customers) {
			expect(customer.company).not.toBe("");
		}
	});

	it("returns 404 for an unknown supplier", async () => {
		const response = await routes.request("/supply-exposure/999");

		expect(response.status).toBe(404);
	});

	it("builds the whole ranking in one Cypher statement (the Builder's doing)", async () => {
		const statements: string[] = [];
		neode.on(
			"query:executed" as never,
			((event: { cypher: string }) => {
				statements.push(event.cypher);
			}) as never,
		);

		await routes.request("/supply-exposure");

		const ranked = statements.filter((statement) =>
			statement.includes("count(DISTINCT c)"),
		);

		expect(ranked).toHaveLength(1);
		expect(ranked[0]).toContain("OPTIONAL MATCH");
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});
