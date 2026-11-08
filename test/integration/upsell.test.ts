import { beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { OrderRepository } from "../../src/repositories/order-repository.js";
import { ProductRepository } from "../../src/repositories/product-repository.js";
import { CustomerRepository } from "../../src/repositories/customer-repository.js";
import { NorthwindService } from "../../src/services/northwind-service.js";
import Neode from "neode";
import { Product, Order, Customer } from "../../src/models/index.js";

describe("upsell + co-purchase reads (NTS-547)", () => {
	let backend: TestBackend;
	let neode: Neode;
	let service: NorthwindService;

	beforeAll(async () => {
		backend = await openBackend();
		neode = backend.neode;
		await seed(neode);

		service = new NorthwindService(
			neode,
			new ProductRepository(neode, Product),
			new OrderRepository(neode, Order),
			new CustomerRepository(neode, Customer),
		);
	}, 300000);

	/** Products already in order 10248. */
	async function ownProductIDs(): Promise<Set<number>> {
		const output = await neode.cypher(
			"MATCH (o:Order { orderID: $id })-[:CONTAINS]->(p:Product) RETURN p.productID AS productID",
			{ id: 10248 },
		);

		return new Set(output.records.map((row) => Number(row.get("productID"))));
	}

	it("ranks co-purchase recommendations, excluding the order's own products", async () => {
		const own = await ownProductIDs();
		const upsell = await service.upsellForOrder(10248, 5);

		expect(upsell).toHaveLength(5);

		for (const reco of upsell) {
			expect(own.has(reco.productID)).toBe(false);
			expect(reco.times).toBeGreaterThan(0);
			expect(reco.name).toBeTruthy();
		}

		// ranked: non-increasing co-occurrence counts
		for (let index = 1; index < upsell.length; index += 1) {
			expect(upsell[index]?.times ?? 0).toBeLessThanOrEqual(
				upsell[index - 1]?.times ?? 0,
			);
		}
	});

	it("projects coPurchased inline on the order read — deduped, own products excluded", async () => {
		const own = await ownProductIDs();
		const order = await neode.find(Order, 10248);

		expect(order).toBeDefined();

		const co = order?.coPurchased ?? [];

		expect(co.length).toBeGreaterThan(0);

		const ids = co.map((product) => product.productID);

		// one element per product, however many paths reach it
		expect(new Set(ids).size).toBe(ids.length);

		for (const id of ids) {
			expect(own.has(id)).toBe(false);
		}
	});
});
