import { describe, expect, it } from "vitest";
import { embed } from "../../src/embed.js";

describe("embed", () => {
	it("is deterministic and 64-dimensional", () => {
		const first = embed("Chef Anton Cajun Seasoning");
		const second = embed("Chef Anton Cajun Seasoning");

		expect(first).toHaveLength(64);
		expect(second).toEqual(first);
	});

	it("is unit-normalised", () => {
		const vector = embed("Gruvbanans Poted Fish");

		const norm = Math.sqrt(
			vector.reduce((sum, value) => sum + value * value, 0),
		);

		expect(norm).toBeCloseTo(1, 5);
	});

	it("puts token-overlapping texts closer than unrelated ones", () => {
		const distance = (a: number[], b: number[]): number =>
			a.reduce((sum, value, index) => sum + (value - b[index]!) ** 2, 0);

		const dairy = embed("fresh dairy milk cheese");
		const dairy2 = embed("aged dairy cheese milk");
		const hardware = embed("steel bolts nails screws");

		expect(distance(dairy, dairy2)).toBeLessThan(distance(dairy, hardware));
	});
});
