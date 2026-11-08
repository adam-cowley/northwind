import { beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { createCategoryAffinityRoutes } from "../../src/features/category-affinity.js";
import Neode from "neode";

/**
NTS-533 — insight features run behind the auth guard as mounted
sub-apps; these tests hit the route handlers with a live Neode instance.
*/
describe("category affinity (NTS-533)", () => {
	let backend: TestBackend;
	let neode: Neode;
	let routes: ReturnType<typeof createCategoryAffinityRoutes>;

	beforeAll(async () => {
		backend = await openBackend();
		neode = backend.neode;
		await seed(neode);

		routes = createCategoryAffinityRoutes(neode);
	}, 300000);

	it("ranks category pairs by shared orders, no self-pairs", async () => {
		const response = await routes.request("/affinity");

		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			pairs: { categoryA: string; categoryB: string; sharedOrders: number }[];
		};

		expect(body.pairs.length).toBeGreaterThan(0);

		for (const [index, pair] of body.pairs.entries()) {
			expect(pair.categoryA).not.toBe(pair.categoryB);
			expect(pair.sharedOrders).toBeGreaterThan(0);

			if (index > 0) {
				expect(body.pairs[index - 1]?.sharedOrders).toBeGreaterThanOrEqual(
					pair.sharedOrders,
				);
			}
		}
	});

	it("is symmetric — every pair appears with its mirror", async () => {
		const response = await routes.request("/affinity");
		const body = (await response.json()) as {
			pairs: { categoryA: string; categoryB: string; sharedOrders: number }[];
		};

		const counts = new Map<string, number>();
		for (const pair of body.pairs) {
			counts.set(`${pair.categoryA}|${pair.categoryB}`, pair.sharedOrders);
		}

		for (const pair of body.pairs) {
			expect(counts.get(`${pair.categoryB}|${pair.categoryA}`)).toBe(
				pair.sharedOrders,
			);
		}
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});
