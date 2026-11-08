import { beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { createDataQualityRoutes } from "../../src/features/data-quality.js";

/**
NTS-536 — data quality checks over the seeded graph. Expected counts are
the seed's ground truth (verified by probe against the dataset and the
engine): the dataset orders EVERY product (neverOrdered = 0 — the brief's
"expect 5" is stale), two customers never order (FISSA, PARIS), four
territories have no employee coverage.
*/
describe("data quality (NTS-536)", () => {
	let backend: TestBackend;
	let routes: ReturnType<typeof createDataQualityRoutes>;

	beforeAll(async () => {
		backend = await openBackend();
		await seed(backend.neode);

		routes = createDataQualityRoutes(backend.neode);
	}, 300000);

	it("reports all five negative-pattern checks", async () => {
		const response = await routes.request("/quality");

		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			checks: {
				id: string;
				label: string;
				count: number;
				examples: string[];
			}[];
		};

		expect(body.checks.map((check) => check.id)).toEqual([
			"neverOrdered",
			"silentCustomers",
			"nakedTerritories",
			"supplierlessProducts",
			"emptyOrders",
		]);

		for (const check of body.checks) {
			expect(typeof check.label).toBe("string");
			expect(check.label).not.toBe("");
			expect(Number.isInteger(check.count)).toBe(true);
			expect(check.count).toBeGreaterThanOrEqual(0);

			// Examples are display strings, capped at 20 per check
			expect(check.examples.length).toBeLessThanOrEqual(20);

			for (const example of check.examples) {
				expect(typeof example).toBe("string");
			}
		}
	});

	it("matches the seed's ground truth counts", async () => {
		const response = await routes.request("/quality");

		const body = (await response.json()) as {
			checks: { id: string; count: number }[];
		};

		const counts = Object.fromEntries(
			body.checks.map((check) => [check.id, check.count]),
		);

		// The dataset orders every product (the brief's "expect 5" is stale)
		expect(counts["neverOrdered"]).toBe(0);
		expect(counts["silentCustomers"]).toBe(2);
		expect(counts["nakedTerritories"]).toBe(4);
		expect(counts["supplierlessProducts"]).toBe(0);
		expect(counts["emptyOrders"]).toBe(0);
	});

	it("names the silent customers as example strings", async () => {
		const response = await routes.request("/quality");

		const body = (await response.json()) as {
			checks: { id: string; count: number; examples: string[] }[];
		};

		const silent = body.checks.find((check) => check.id === "silentCustomers");

		expect(silent?.count).toBe(2);
		expect(silent?.examples).toEqual([
			"FISSA Fabrica Inter. Salchichas S.A.",
			"Paris spécialités",
		]);
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});
