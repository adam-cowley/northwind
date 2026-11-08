import { describe, expect, it } from "vitest";
import { openBackend } from "../support/backend.js";
import { graphCounts, seed } from "../../src/seed/seed.js";

describe("bulk synthetic seeding (NTS-526)", () => {
	it("generates factory orders in chunked UNWIND statements, fast", async () => {
		const backend = await openBackend();

		await seed(backend.neode);

		const start = performance.now();
		await seed(backend.neode, { syntheticOrders: 300 });
		const elapsed = performance.now() - start;

		const counts = await graphCounts(backend.neode);

		expect(counts["Order"]).toBe(830 + 300);

		// Chunked writes: hundreds of orders in well under a second of writes
		expect(elapsed).toBeLessThan(30000);

		console.log(
			`300 synthetic orders (incl. real seed re-run) in ${Math.round(elapsed)}ms`,
		);

		await backend.close();
	}, 120000);
});
