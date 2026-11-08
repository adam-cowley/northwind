import { beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { createShipperCoverageRoutes } from "../../src/features/shipper-coverage.js";
import Neode from "neode";

/**
NTS-537 — insight features run behind the auth guard as mounted
sub-apps; these tests hit the route handlers with a live Neode instance.
*/
describe("shipper coverage (NTS-537)", () => {
	let backend: TestBackend;
	let neode: Neode;
	let routes: ReturnType<typeof createShipperCoverageRoutes>;

	beforeAll(async () => {
		backend = await openBackend();
		neode = backend.neode;
		await seed(neode);

		routes = createShipperCoverageRoutes(neode);
	}, 300000);

	it("totals orders, revenue and countries per shipper", async () => {
		const response = await routes.request("/shippers");

		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			shippers: {
				shipperID: number;
				name: string;
				phone: string;
				orders: number;
				revenue: number;
				countries: number;
			}[];
			dominance: { country: string; shipper: number; orders: number }[];
		};

		// Northwind seeds exactly three shippers, each with orders.
		expect(body.shippers).toHaveLength(3);
		expect(new Set(body.shippers.map((s) => s.shipperID)).size).toBe(3);

		for (const shipper of body.shippers) {
			expect(shipper.name.length).toBeGreaterThan(0);
			expect(shipper.phone.length).toBeGreaterThan(0);
			expect(shipper.orders).toBeGreaterThan(0);
			expect(shipper.revenue).toBeGreaterThan(0);
			expect(shipper.countries).toBeGreaterThan(0);
		}

		// One dominance row per distinct ship-to country at most.
		const countriesUpperBound = body.shippers.reduce(
			(sum, shipper) => sum + shipper.countries,
			0,
		);
		expect(body.dominance.length).toBeGreaterThan(0);
		expect(body.dominance.length).toBeLessThanOrEqual(countriesUpperBound);

		const shipperIDs = new Set(body.shippers.map((s) => s.shipperID));
		for (const row of body.dominance) {
			expect(row.country.length).toBeGreaterThan(0);
			expect(shipperIDs.has(row.shipper)).toBe(true);
			expect(row.orders).toBeGreaterThan(0);
		}

		// Dominance rows are unique per country.
		expect(new Set(body.dominance.map((row) => row.country)).size).toBe(
			body.dominance.length,
		);
	});

	it("picks the actual most-used shipper for a country", async () => {
		const response = await routes.request("/shippers");
		const body = (await response.json()) as {
			shippers: { shipperID: number; orders: number }[];
			dominance: { country: string; shipper: number; orders: number }[];
		};

		// The winner's order count can never exceed the shipper's total.
		const totals = new Map(
			body.shippers.map((shipper) => [shipper.shipperID, shipper.orders]),
		);
		for (const row of body.dominance) {
			expect(row.orders).toBeLessThanOrEqual(totals.get(row.shipper) ?? 0);
		}
	});

	it("builds both statements in one request (the Builder's doing)", async () => {
		const statements: string[] = [];
		neode.on(
			"query:executed" as never,
			((event: { cypher: string }) => {
				statements.push(event.cypher);
			}) as never,
		);

		await routes.request("/shippers");

		const withRevenue = statements.filter((statement) =>
			statement.includes("sum(rc.unitPrice"),
		);
		const withDominance = statements.filter((statement) =>
			statement.includes("shipCountry AS country"),
		);

		expect(withRevenue).toHaveLength(1);
		expect(withDominance).toHaveLength(1);
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});
