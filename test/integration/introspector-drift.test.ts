import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import Neode from "neode";

/**
Introspector drift-check (NTS-164): seed the catalog → generateModels()
against the live graph → the generated Product definition matches the
declared model, and the installed schema shows no drift on the
introspected label. The in-memory backend is per-file, so the seed is
this test's own data; assertions stay scoped to the Product label.
*/
describe("generateModels round-trip on the seeded catalog (NTS-164)", () => {
	let backend: TestBackend;
	let neode: Neode;

	beforeAll(async () => {
		backend = await openBackend();
		neode = backend.neode;
		await seed(neode);
	}, 300000);

	afterAll(async () => {
		await backend.close();
	});

	it("introspects the declared Product shape from the seeded graph", async () => {
		// The walk keeps only relationships whose TARGET label is in scope,
		// so the introspection covers Product's two outgoing hops too
		const result = await neode.generateModels({
			labels: ["Product", "Supplier", "Category"],
		});

		const product = result.models.find((model) => model.label === "Product");
		expect(product).toBeDefined();

		// The unique constraint's property is the primary-key suggestion
		expect(product?.primaryKey).toBe("productID");
		expect(product?.schema["productID"]).toEqual({
			type: "number",
			primary: true,
		});

		// Value types inferred from the sampled catalog rows
		expect(product?.schema["name"]).toEqual({ type: "string" });
		expect(product?.schema["quantityPerUnit"]).toEqual({ type: "string" });
		expect(product?.schema["unitPrice"]).toEqual({ type: "number" });
		expect(product?.schema["unitsInStock"]).toEqual({ type: "number" });
		expect(product?.schema["discontinued"]).toEqual({ type: "boolean" });

		// The stored vector property is seen as a number array
		expect(product?.schema["embedding"]).toEqual({
			type: "number",
			array: true,
		});

		// Outgoing relationships, one declaration per (type, target) — the
		// declared @RelatedOne projections introspect as relatedOne
		expect(product?.schema["SUPPLIED_BY"]).toEqual({
			type: "relatedOne",
			relationship: "SUPPLIED_BY",
			direction: "out",
			target: "Supplier",
		});
		expect(product?.schema["PART_OF"]).toEqual({
			type: "relatedOne",
			relationship: "PART_OF",
			direction: "out",
			target: "Category",
		});
	});

	it("shows no schema drift on the introspected label", async () => {
		const drift = await neode.schemaDiff();

		const onProduct = (entry: { labelsOrTypes: string[] }): boolean =>
			entry.labelsOrTypes.includes("Product");

		expect(drift.constraints.missing.filter(onProduct)).toEqual([]);
		expect(drift.constraints.stale.filter(onProduct)).toEqual([]);
		expect(drift.constraints.mismatched.filter(onProduct)).toEqual([]);
		expect(drift.indexes.missing.filter(onProduct)).toEqual([]);
		expect(drift.indexes.stale.filter(onProduct)).toEqual([]);
	});
});
