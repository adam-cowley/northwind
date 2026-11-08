import { beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { createGrowthBoardRoutes } from "../../src/features/growth-board.js";
import Neode from "neode";

/**
NTS-535 — growth board: per-product-per-month revenue in ONE Builder
statement, MoM deltas ranked in TypeScript.
*/
interface MovementRow {
	productID: number;
	name: string;
	month: string;
	revenue: number;
	previousRevenue: number;
	delta: number;
}

describe("growth board (NTS-535)", () => {
	let backend: TestBackend;
	let neode: Neode;
	let routes: ReturnType<typeof createGrowthBoardRoutes>;

	beforeAll(async () => {
		backend = await openBackend();
		neode = backend.neode;
		await seed(neode);

		routes = createGrowthBoardRoutes(neode);
	}, 300000);

	it("ranks MoM risers and fallers for the max month with data", async () => {
		const response = await routes.request("/growth?limit=5");

		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			month: string | null;
			risers: MovementRow[];
			fallers: MovementRow[];
		};

		expect(body.month).toMatch(/^\d{4}-\d{2}$/);
		for (const rows of [body.risers, body.fallers]) {
			expect(rows.length).toBeGreaterThan(0);
			expect(rows.length).toBeLessThanOrEqual(5);
			for (const row of rows) {
				expect(row.month).toBe(body.month);
				expect(row.revenue - row.previousRevenue).toBe(row.delta);
			}
		}

		for (const riser of body.risers) {
			expect(riser.delta).toBeGreaterThan(0);
		}
		for (const faller of body.fallers) {
			expect(faller.delta).toBeLessThan(0);
		}

		// Ranked: best riser first, worst faller first
		for (const [index, riser] of body.risers.entries()) {
			if (index > 0) {
				expect(body.risers[index - 1]?.delta).toBeGreaterThanOrEqual(
					riser.delta,
				);
			}
		}
		for (const [index, faller] of body.fallers.entries()) {
			if (index > 0) {
				expect(body.fallers[index - 1]?.delta).toBeLessThanOrEqual(
					faller.delta,
				);
			}
		}
	});

	it("honours a ?month= param", async () => {
		const response = await routes.request("/growth?month=1997-03&limit=3");

		expect(response.status).toBe(200);

		const body = (await response.json()) as {
			month: string;
			risers: MovementRow[];
			fallers: MovementRow[];
		};

		expect(body.month).toBe("1997-03");
		for (const row of [...body.risers, ...body.fallers]) {
			expect(row.month).toBe("1997-03");
		}
		expect(body.risers.length).toBeLessThanOrEqual(3);
		expect(body.fallers.length).toBeLessThanOrEqual(3);
	});

	it("builds the whole revenue series in one Cypher statement (the Builder's doing)", async () => {
		const statements: string[] = [];
		neode.on(
			"query:executed" as never,
			((event: { cypher: string }) => {
				statements.push(event.cypher);
			}) as never,
		);

		await routes.request("/growth");

		const ranked = statements.filter((statement) =>
			statement.includes("AS revenue"),
		);

		expect(ranked).toHaveLength(1);
		expect(ranked[0]).toContain("substring(toString(o.orderDate), 0, 7)");
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});
