import { beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { createRegionRollupRoutes } from "../../src/features/region-rollup.js";
import Neode from "neode";

/**
NTS-540 — region rollup: revenue through the territory hierarchy,
hit through the mounted-route handler shape with a live Neode instance.
*/
describe("region rollup (NTS-540)", () => {
	let backend: TestBackend;
	let neode: Neode;
	let routes: ReturnType<typeof createRegionRollupRoutes>;

	beforeAll(async () => {
		backend = await openBackend();
		neode = backend.neode;
		await seed(neode);

		routes = createRegionRollupRoutes(neode);
	}, 300000);

	it("rolls revenue up through territory → employee → order", async () => {
		const response = await routes.request("/regions");

		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			regions: {
				regionID: number;
				name: string;
				territories: number;
				employees: string[];
				orders: number;
				revenue: number;
			}[];
		};

		expect(body.regions).toHaveLength(4);

		let territoryTotal = 0;
		let withEmployees = 0;

		for (const [index, region] of body.regions.entries()) {
			expect(region.revenue).toBeGreaterThan(0);
			expect(region.territories).toBeGreaterThan(0);
			expect(region.orders).toBeGreaterThan(0);

			if (region.employees.length > 0) {
				withEmployees += 1;
			}

			territoryTotal += region.territories;

			// Ranked by revenue, biggest first
			if (index > 0) {
				expect(body.regions[index - 1]?.revenue).toBeGreaterThanOrEqual(
					region.revenue,
				);
			}
		}

		expect(territoryTotal).toBe(53);
		expect(withEmployees).toBeGreaterThanOrEqual(2);
	});

	it("builds the whole rollup in one Cypher statement (the Builder's doing)", async () => {
		const statements: string[] = [];
		neode.on(
			"query:executed" as never,
			((event: { cypher: string }) => {
				statements.push(event.cypher);
			}) as never,
		);

		await routes.request("/regions");

		const rollups = statements.filter((statement) =>
			statement.includes("IN_REGION"),
		);

		expect(rollups).toHaveLength(1);
		expect(rollups[0]).toContain("collect(DISTINCT emp.firstName");
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});
