import { beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { createProductLinksRoutes } from "../../src/features/product-links.js";
import Neode from "neode";

/**
NTS-534 — product links run behind the auth guard as mounted sub-apps;
these tests hit the route handlers with a live Neode instance.
*/
describe("product links (NTS-534)", () => {
	let backend: TestBackend;
	let neode: Neode;
	let routes: ReturnType<typeof createProductLinksRoutes>;

	beforeAll(async () => {
		backend = await openBackend();
		neode = backend.neode;
		await seed(neode);

		routes = createProductLinksRoutes(neode);
	}, 300000);

	it("connects products 1 and 2 through at least one path", async () => {
		const response = await routes.request("/links?a=1&b=2");

		expect(response.status).toBe(200);

		const links = (await response.json()) as {
			via: string;
			hops: { from: string; type: string; to: string }[];
		}[];

		expect(Array.isArray(links)).toBe(true);
		expect(links.length).toBeGreaterThan(0);

		for (const link of links) {
			expect(["shared-order", "shared-supplier", "shared-customer"]).toContain(
				link.via,
			);
			expect(link.hops.length).toBeGreaterThan(0);

			// The path runs from the first product to the second (display form)
			expect(link.hops[0]?.from).toContain("(#1)");
			expect(link.hops[link.hops.length - 1]?.to).toContain("(#2)");
		}
	});

	it("hop sequences reference real ids from the graph", async () => {
		const shared = await neode.readCypher(
			"MATCH (a:Product {productID: 1})<-[:CONTAINS]-(o:Order)-[:CONTAINS]->(:Product {productID: 2}) RETURN collect(o.orderID) AS ids",
			{},
		);
		const orderIDs = (shared.records[0]?.get("ids") as number[]).map(Number);

		const response = await routes.request("/links?a=1&b=2");
		const links = (await response.json()) as {
			via: string;
			hops: { from: string; type: string; to: string }[];
		}[];

		const viaOrder = links.find((link) => link.via === "shared-order");

		expect(viaOrder).toBeDefined();
		expect(viaOrder?.hops.length).toBe(2);

		const rendered = viaOrder!.hops
			.map((hop) => `${hop.from}|${hop.type}|${hop.to}`)
			.join("\n");

		// shortestPath picks one of the real shared orders (not always the
		// same one a plain LIMIT 1 returns)
		const viaOrderID = Number(/Order #(\d+)/.exec(rendered)?.[1]);
		expect(orderIDs).toContain(viaOrderID);
		expect(rendered).toContain("CONTAINS");
	});

	it("returns an empty list gracefully for unconnected products", async () => {
		// Its own supplier, never ordered — nothing to share with product 1
		await neode.writeCypher(
			`MERGE (p:Product {productID: $id})
			 SET p.name = $name, p.unitPrice = 10.0, p.unitsInStock = 5,
				 p.discontinued = false, p.version = 1
			 MERGE (s:Supplier {supplierID: $sid})
			 SET s.companyName = $company
			 MERGE (p)-[:SUPPLIED_BY]->(s)`,
			{ id: 1000, name: "Lone Product", sid: 900, company: "Nowhere Goods" },
		);

		for (const query of ["a=1000&b=1", "a=9999&b=8888", "a=1&b=1"]) {
			const response = await routes.request(`/links?${query}`);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual([]);
		}
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});
