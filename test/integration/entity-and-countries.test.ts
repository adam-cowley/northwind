import { beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { createEntityDetailRoutes } from "../../src/features/entity-detail.js";
import { createCountryRoutes } from "../../src/features/country-drilldown.js";
import { createCustomerJourneysRoutes } from "../../src/features/customer-journeys.js";
import Neode from "neode";

/**
The "ID in the list" pattern's backbone: the generic entity view
(any type → properties + typed 1-hop neighborhood with resolvable
neighbor types) and the country drilldown.
*/
describe("entity detail + country drilldown", () => {
	let backend: TestBackend;
	let neode: Neode;
	let entities: ReturnType<typeof createEntityDetailRoutes>;
	let countries: ReturnType<typeof createCountryRoutes>;
	let journeys: ReturnType<typeof createCustomerJourneysRoutes>;

	beforeAll(async () => {
		backend = await openBackend();
		neode = backend.neode;
		await seed(neode);

		entities = createEntityDetailRoutes(neode);
		countries = createCountryRoutes(neode);
		journeys = createCustomerJourneysRoutes(neode);
	}, 300000);

	it("serves an order with typed edges + resolvable neighbors", async () => {
		const response = await entities.request("/Order/11077");

		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			type: string;
			display: string;
			properties: Record<string, unknown>;
			edges: {
				relType: string;
				direction: string;
				neighborType?: string;
				neighborId?: unknown;
			}[];
		};

		expect(body.type).toBe("Order");
		expect(body.display).toContain("#");
		expect(body.properties["orderID"]).toBe(11077);

		// Every edge names its neighbor's type + id — the IdLink contract
		for (const edge of body.edges) {
			expect(edge.neighborType).toBeTruthy();
			expect(edge.neighborId).not.toBeUndefined();
		}

		const types = body.edges.map((edge) => edge.relType);
		expect(types).toContain("PLACED_BY");
		expect(types).toContain("CONTAINS");
	});

	it("serves a product with supplier + category neighbors", async () => {
		const response = await entities.request("/Product/1");
		const body = (await response.json()) as {
			display: string;
			edges: { relType: string; neighborType?: string }[];
		};

		expect(response.status).toBe(200);
		expect(body.display).toBe("Chai");

		const relTypes = body.edges.map((edge) => edge.relType);
		expect(relTypes).toContain("SUPPLIED_BY");
		expect(relTypes).toContain("PART_OF");
		expect(relTypes).toContain("CONTAINS");
	});

	it("404s unknown entities and unknown types", async () => {
		expect((await entities.request("/Product/99999")).status).toBe(404);
		expect((await entities.request("/Ghost/1")).status).toBe(400);
	});

	it("ranks countries by revenue and drills into one", async () => {
		const list = await countries.request("/countries");
		const listBody = (await list.json()) as {
			countries: {
				country: string;
				orders: number;
				revenue: number;
				products: number;
			}[];
		};

		expect(list.status).toBe(200);
		expect(listBody.countries.length).toBeGreaterThan(10);

		// Ranked by revenue descending
		expect(listBody.countries[0]?.revenue).toBeGreaterThanOrEqual(
			listBody.countries[1]?.revenue ?? 0,
		);

		const top = listBody.countries[0]?.country ?? "";
		const drill = await countries.request(
			`/countries/${encodeURIComponent(top)}`,
		);
		const drillBody = (await drill.json()) as {
			country: string;
			products: {
				productID: number;
				name: string;
				orders: number;
				revenue: number;
			}[];
		};

		expect(drill.status).toBe(200);
		expect(drillBody.country).toBe(top);
		expect(drillBody.products.length).toBeGreaterThan(5);

		// Ranked by revenue descending
		expect(drillBody.products[0]?.revenue).toBeGreaterThanOrEqual(
			drillBody.products[1]?.revenue ?? 0,
		);
	});

	it("expands a journey transition into customers + their two orders", async () => {
		// The top transition from the ranking
		const ranking = await journeys.request("/journeys");
		const rankingBody = (await ranking.json()) as {
			transitions: {
				fromProductID: number;
				toProductID: number;
				customers: number;
			}[];
		};

		const top = rankingBody.transitions[0];

		expect(top).toBeDefined();

		const drill = await journeys.request(
			`/journeys/${top?.fromProductID}/${top?.toProductID}`,
		);

		const drillBody = (await drill.json()) as {
			fromProductID: number;
			toProductID: number;
			journeys: {
				customerID: string;
				company: string;
				firstOrderID: number;
				secondOrderID: number;
			}[];
		};

		expect(drill.status).toBe(200);
		expect(drillBody.journeys.length).toBeGreaterThan(0);
		expect(drillBody.journeys.length).toBeLessThanOrEqual(top?.customers ?? 0);

		for (const journey of drillBody.journeys) {
			expect(journey.firstOrderID).not.toBe(journey.secondOrderID);
			expect(journey.company).toBeTruthy();
		}
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});
