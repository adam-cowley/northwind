import { beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { graphCounts, seed } from "../../src/seed/seed.js";

describe("seed (the idempotent Northwind load)", () => {
	let backend: TestBackend;
	let stats: Awaited<ReturnType<typeof seed>>;

	beforeAll(async () => {
		backend = await openBackend();
		stats = await seed(backend.neode);
	}, 300000);

	it("loads the whole dataset", () => {
		expect(stats.products).toBe(77);
		expect(stats.customers).toBe(91);
		expect(stats.orders).toBe(830);
		expect(stats.categories).toBe(8);
		expect(stats.suppliers).toBe(29);
		expect(stats.employees).toBe(9);
		expect(stats.shippers).toBe(3);
		expect(stats.regions).toBe(4);
		expect(stats.lines).toBeGreaterThan(2000);
	});

	it("lands every node with its label", async () => {
		const counts = await graphCounts(backend.neode);

		expect(counts["Product"]).toBe(77);
		expect(counts["Customer"]).toBe(91);
		expect(counts["Order"]).toBe(830);
		expect(counts["Category"]).toBe(8);
		expect(counts["Supplier"]).toBe(29);
		expect(counts["Region"]).toBe(4);
	});

	it("is idempotent: seeding twice changes no counts", async () => {
		await seed(backend.neode);

		const counts = await graphCounts(backend.neode);

		expect(counts["Product"]).toBe(77);
		expect(counts["Order"]).toBe(830);
	});

	it("labels the ten bestsellers (the runCypherScript step)", async () => {
		const output = await backend.neode.readCypher(
			"MATCH (p:Bestseller) RETURN count(p) AS count",
			{},
		);

		expect(Number(output.records[0]?.get("count"))).toBe(10);
		expect(stats.bestsellers).toBe(10);
	});

	it("stores the @Vector embeddings (64 dims, computed from name)", async () => {
		const output = await backend.neode.readCypher(
			"MATCH (p:Product) RETURN count(p) AS total, count(p.embedding) AS embedded",
			{},
		);

		expect(Number(output.records[0]?.get("total"))).toBe(77);
		expect(Number(output.records[0]?.get("embedded"))).toBe(77);

		const sample = await backend.neode.readCypher(
			"MATCH (p:Product) RETURN p.embedding AS embedding LIMIT 1",
			{},
		);

		const embedding = sample.records[0]?.get("embedding") as
			| unknown[]
			| undefined;
		expect(embedding).toHaveLength(64);
	});

	it("stamps supplier points", async () => {
		const output = await backend.neode.readCypher(
			"MATCH (s:Supplier) RETURN count(s.location) AS located",
			{},
		);

		expect(Number(output.records[0]?.get("located"))).toBe(29);
	});

	it("relates the graph: placed orders carry customer, employee and lines", async () => {
		const output = await backend.neode.readCypher(
			"MATCH (o:Order)-[:PLACED_BY]->(c:Customer) WITH count(o) AS placed " +
				"MATCH (o2:Order)-[:CONTAINS]->(p:Product) RETURN placed, count(o2) AS withLines",
			{},
		);

		expect(Number(output.records[0]?.get("placed"))).toBe(830);
		expect(Number(output.records[0]?.get("withLines"))).toBeGreaterThan(800);
	});

	it("computes timeToShip durations for shipped orders", async () => {
		const output = await backend.neode.readCypher(
			"MATCH (o:Order) WHERE o.shippedDate IS NOT NULL RETURN count(o.timeToShip) AS timed",
			{},
		);

		expect(Number(output.records[0]?.get("timed"))).toBeGreaterThan(0);
	});

	it("installs the schema: unique constraints + fulltext + vector indexes", async () => {
		const output = await backend.neode.readCypher(
			"SHOW INDEXES YIELD name, type",
			{},
		);

		const names = output.records.map((row) => String(row.get("name")));

		// Range (unique + index), fulltext and vector families all present.
		// NTS-598 made schema object names injective: readable part is
		// lowercased with a deterministic hash suffix, so assert on the
		// lowercased name prefix rather than the full name.
		const hasObject = (prefix: string) =>
			names.some((name) => name.startsWith(prefix));
		expect(hasObject("product_productid_unique")).toBe(true);
		expect(hasObject("product_name_supplierid_unique")).toBe(true); // NTS-140 composite
		expect(hasObject("product_name_fulltext")).toBe(true);
		expect(hasObject("product_embedding_vector")).toBe(true);
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});
