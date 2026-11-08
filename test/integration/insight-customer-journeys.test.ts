import { beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { createCustomerJourneysRoutes } from "../../src/features/customer-journeys.js";
import Neode from "neode";

/**
NTS-539 — customer journeys: first-product → next-product transitions
aggregated across customers, hit as a mounted sub-app with a live Neode
instance.
*/
describe("customer journeys (NTS-539)", () => {
	let backend: TestBackend;
	let neode: Neode;
	let routes: ReturnType<typeof createCustomerJourneysRoutes>;

	beforeAll(async () => {
		backend = await openBackend();
		neode = backend.neode;
		await seed(neode);

		routes = createCustomerJourneysRoutes(neode);
	}, 300000);

	it("ranks transitions by how many customers made each", async () => {
		const response = await routes.request("/journeys");

		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			transitions: {
				fromProductID: number;
				toProductID: number;
				customers: number;
			}[];
		};

		expect(body.transitions.length).toBeGreaterThan(0);
		expect(body.transitions.length).toBeLessThanOrEqual(15);

		// Ranked descending, no self-transition, every count real
		for (const [index, transition] of body.transitions.entries()) {
			expect(transition.fromProductID).not.toBe(transition.toProductID);
			expect(transition.customers).toBeGreaterThan(0);

			if (index > 0) {
				expect(body.transitions[index - 1]?.customers).toBeGreaterThanOrEqual(
					transition.customers,
				);
			}
		}
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});
