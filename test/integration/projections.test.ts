import { beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { OrderRepository } from "../../src/repositories/order-repository.js";
import { ProductRepository } from "../../src/repositories/product-repository.js";
import { CustomerRepository } from "../../src/repositories/customer-repository.js";
import { NorthwindService } from "../../src/services/northwind-service.js";
import Neode from "neode";
import { Product, Order, Customer } from "../../src/models/index.js";

describe("catalog read-model + search (projections, fulltext, knn)", () => {
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

	it("the catalog page carries every projected field from one query", async () => {
		const catalog = await service.catalog(1, 12);

		expect(catalog.total).toBe(77);
		expect(catalog.items).toHaveLength(12);

		for (const product of catalog.items) {
			expect(product.supplier).toBeDefined();
			expect(product.supplier?.companyName).toBeTruthy();
			// Single-field RelatedOne projects flat: a scalar, not a DTO
			expect(typeof product.category).toBe("string");
			expect(product.category?.length ?? 0).toBeGreaterThan(0);
			expect(typeof product.orderCount).toBe("number");
			expect(product.orderCount).toBeGreaterThan(0);
			expect(typeof product.hasBeenOrdered).toBe("boolean");
			expect(typeof product.inStock).toBe("boolean");
			expect(typeof product.belowReorder).toBe("number");
		}
	});

	it("marks exactly the ten bestsellers via the label predicate", async () => {
		const catalog = await service.catalog(1, 100);

		const bestsellers = catalog.items.filter((product) => product.isBestseller);

		expect(bestsellers).toHaveLength(10);
	});

	it("full-text search finds the product category words (Lucene-escaped)", async () => {
		const hits = await service.searchProducts("Cajun", 5);

		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0]?.entity.name).toContain("Cajun");
	});

	it("kNN surfaces the nearest products by embedding", async () => {
		const product = await service.products.find(4);

		if (product === undefined) {
			throw new Error("product 4 missing");
		}

		const similar = await service.similar(product, 5);

		expect(similar).toHaveLength(5);
		expect(similar[0]?.score).toBeGreaterThan(0);
	});

	it("the dirty-tracking save writes only changed fields", async () => {
		const product = await service.products.find(4);

		if (product === undefined) {
			throw new Error("product 4 missing");
		}

		const versionBefore = product.version;
		product.unitPrice = product.unitPrice + 1;

		const saved = await service.products.save(product);

		expect(saved.version).toBe(versionBefore + 1);

		// The other properties are untouched server-side
		const output = await neode.readCypher(
			"MATCH (p:Product { productID: 4 }) RETURN p.name AS name",
			{},
		);

		expect(output.records[0]?.get("name")).toBe(product.name);
	});

	it("restock is an atomic server-side increment", async () => {
		const product = await service.products.find(4);

		if (product === undefined) {
			throw new Error("product 4 missing");
		}

		const before = product.unitsInStock;
		const after = await service.restock(product, 25);

		expect(after).toBe(before + 25);
	});

	it("the customer 360 profile carries the projected order count + history", async () => {
		const profile = await service.customerProfile("ANTON");

		expect(profile.customer.customerID).toBe("ANTON");
		expect(profile.customer.orderCount).toBeGreaterThan(0);
		expect(profile.history.length).toBeGreaterThan(0);
	});

	it("analytics run pure Builder queries", async () => {
		const revenue = await service.revenueByCountry(5);
		const top = await service.topProducts(5);

		expect(revenue.length).toBeGreaterThan(0);
		expect(revenue[0]?.revenue).toBeGreaterThan(0);
		expect(top.length).toBeGreaterThan(0);
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});
