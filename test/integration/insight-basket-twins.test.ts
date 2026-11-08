import { beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { createBasketTwinsRoutes } from "../../src/features/basket-twins.js";
import Neode, { jsonSafeRecord } from "neode";

/**
NTS-531 — insight features run behind the auth guard as mounted
sub-apps; these tests hit the route handlers with a live Neode instance.
*/
describe("basket twins (NTS-531)", () => {
	let backend: TestBackend;
	let neode: Neode;
	let routes: ReturnType<typeof createBasketTwinsRoutes>;

	beforeAll(async () => {
		backend = await openBackend();
		neode = backend.neode;
		await seed(neode);

		routes = createBasketTwinsRoutes(neode);
	}, 300000);

	it("ranks customers by basket overlap with the given customer", async () => {
		const response = await routes.request("/twins/ANTON");

		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			customer: string;
			twins: { id: string; sharedProducts: number; jaccard: number }[];
		};

		expect(body.customer).toBe("ANTON");
		expect(body.twins.length).toBeGreaterThan(0);
		expect(body.twins.length).toBeLessThanOrEqual(10);

		// Ranked descending, no self-match
		for (const [index, twin] of body.twins.entries()) {
			expect(twin.id).not.toBe("ANTON");
			expect(twin.sharedProducts).toBeGreaterThan(0);
			expect(twin.jaccard).toBeGreaterThanOrEqual(0);

			if (index > 0) {
				expect(body.twins[index - 1]?.jaccard).toBeGreaterThanOrEqual(
					twin.jaccard,
				);
			}
		}
	});

	it("returns different twins for a different customer", async () => {
		const anton = await routes.request("/twins/ANTON");
		const alfki = await routes.request("/twins/ALFKI");

		const antonBody = (await anton.json()) as { twins: { id: string }[] };
		const alfkiBody = (await alfki.json()) as { twins: { id: string }[] };

		expect(alfkiBody.customer).toBe("ALFKI");
		expect(alfkiBody.twins[0]?.id).not.toBe(antonBody.twins[0]?.id);
	});

	it("builds the whole ranking in one Cypher statement (the Builder's doing)", async () => {
		const statements: string[] = [];
		neode.on(
			"query:executed" as never,
			((event: { cypher: string }) => {
				statements.push(event.cypher);
			}) as never,
		);

		await routes.request("/twins/SAVEA");

		const ranked = statements.filter((statement) =>
			statement.includes("jaccard"),
		);

		expect(ranked).toHaveLength(1);
		expect(ranked[0]).toContain("collect(DISTINCT p2)");
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});
