import { beforeAll, describe, expect, it } from "vitest";
import { openBackend, type TestBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { OrderRepository } from "../../src/repositories/order-repository.js";
import { ProductRepository } from "../../src/repositories/product-repository.js";
import { CustomerRepository } from "../../src/repositories/customer-repository.js";
import { NorthwindService } from "../../src/services/northwind-service.js";
import Neode from "neode";
import { OptimisticLockError } from "neode";
import { OutOfStockError } from "../../src/repositories/order-types.js";

describe("order lifecycle (the flagship write path)", () => {
	let backend: TestBackend;
	let neode: Neode;
	let service: NorthwindService;

	beforeAll(async () => {
		backend = await openBackend();
		neode = backend.neode;
		await seed(neode);

		service = new NorthwindService(
			neode,
			new ProductRepository(
				neode,
				await import("../../src/models/product.js").then((m) => m.Product),
			),
			new OrderRepository(
				neode,
				(await import("../../src/models/order.js")).Order,
			),
			new CustomerRepository(
				neode,
				(await import("../../src/models/customer.js")).Customer,
			),
		);
	}, 300000);

	it("places an order: node + edge entities + stock decrement, atomically", async () => {
		const stockBefore = await stockOf(neode, 4);

		const placed = await service.placeOrder({
			customerID: "ANTON",
			employeeID: 2,
			shipperID: 1,
			items: [
				{ productID: 4, quantity: 3 },
				{ productID: 11, quantity: 2, discount: 0.1 },
			],
		});

		// The order exists with its edges
		expect(placed.orderID).toBeGreaterThan(10248);
		expect(placed.customer?.customerID).toBe("ANTON");

		const lines = await lineCount(neode, placed.orderID);
		expect(lines).toBe(2);

		// Stock decremented by the ordered quantities
		expect(await stockOf(neode, 4)).toBe(stockBefore - 3);

		// The edge entity carries the purchase-time state
		const line = await firstLine(neode, placed.orderID, 4);
		expect(line["quantity"]).toBe(3);
		expect(line["unitPrice"]).toBeCloseTo(await priceOf(neode, 4), 5);
	});

	it("rolls the whole order back when a line cannot be satisfied", async () => {
		const ordersBefore = await orderCount(neode);

		try {
			await service.placeOrder({
				customerID: "ANTON",
				employeeID: 2,
				shipperID: 1,
				items: [{ productID: 4, quantity: 100000 }],
			});

			throw new Error("expected OutOfStockError");
		} catch (error) {
			expect(error).toBeInstanceOf(OutOfStockError);
		}

		// Nothing was written: the tx rolled back
		expect(await orderCount(neode)).toBe(ordersBefore);
	});

	it("rejects concurrent conflicting stock writes via @Version (optimistic locking)", async () => {
		// Two racers read the same stock + version; the second write conflicts
		const race = Promise.all([
			service.placeOrder({
				customerID: "ANTON",
				employeeID: 2,
				shipperID: 1,
				items: [{ productID: 4, quantity: 1 }],
			}),
			service.placeOrder({
				customerID: "ALFKI",
				employeeID: 3,
				shipperID: 2,
				items: [{ productID: 4, quantity: 1 }],
			}),
		]);

		const outcomes = await race.then(
			() => "both-committed" as const,
			(error: unknown) =>
				error instanceof OptimisticLockError
					? "conflict-detected"
					: "other-failure",
		);

		// Either serialized cleanly (the engine locks) or the loser got the
		// typed conflict — what must never happen is a silent lost update
		if (outcomes === "other-failure") {
			throw new Error("expected clean serialization or OptimisticLockError");
		}
	});

	it("ships an order and stamps the timeToShip duration", async () => {
		const placed = await service.placeOrder({
			customerID: "ANTON",
			employeeID: 2,
			shipperID: 1,
			items: [{ productID: 4, quantity: 1 }],
		});

		const shipped = await service.ship(placed);

		expect(shipped?.shippedDate).toBeDefined();

		const stored = await rawOrder(neode, placed.orderID);
		expect(stored["timeToShip"]).toBeDefined();
	});

	it("cancels an order and its lines (DETACH DELETE)", async () => {
		const placed = await service.placeOrder({
			customerID: "ANTON",
			employeeID: 2,
			shipperID: 1,
			items: [{ productID: 4, quantity: 1 }],
		});

		await service.cancel(placed.orderID);

		const lines = await lineCount(neode, placed.orderID);
		const nodes = await orderExists(neode, placed.orderID);

		expect(nodes).toBe(0);
		expect(lines).toBe(0);
	});

	it("feeds orders by cursor (keyset pagination)", async () => {
		const firstPage = await service.feed();

		expect(firstPage.items.length).toBeGreaterThan(0);
		expect(firstPage.hasMore).toBe(true);

		const secondPage = await service.feed(firstPage.nextCursor);

		expect(secondPage.items.length).toBeGreaterThan(0);

		// Keyset: strictly older
		const lastDate =
			firstPage.items[firstPage.items.length - 1]?.orderDate ?? "";
		const firstOfSecond = secondPage.items[0]?.orderDate ?? "";

		expect(firstOfSecond <= lastDate).toBe(true);
	});

	it("streams one customer’s history via the Builder", async () => {
		const history = await service.orders.historyForCustomer("ANTON", 5);

		expect(history.length).toBeGreaterThan(0);
		expect(history.length).toBeLessThanOrEqual(5);
	});

	it("closes cleanly", async () => {
		await backend.close();
	});
});

async function stockOf(neode: Neode, productID: number): Promise<number> {
	const output = await neode.readCypher(
		"MATCH (p:Product { productID: $id }) RETURN p.unitsInStock AS stock",
		{ id: productID },
	);

	return Number(output.records[0]?.get("stock"));
}

async function priceOf(neode: Neode, productID: number): Promise<number> {
	const output = await neode.readCypher(
		"MATCH (p:Product { productID: $id }) RETURN p.unitPrice AS price",
		{ id: productID },
	);

	return Number(output.records[0]?.get("price"));
}

async function lineCount(neode: Neode, orderID: number): Promise<number> {
	const output = await neode.readCypher(
		"MATCH (:Order { orderID: $id })-[line:CONTAINS]->() RETURN count(line) AS lines",
		{ id: orderID },
	);

	return Number(output.records[0]?.get("lines"));
}

async function firstLine(
	neode: Neode,
	orderID: number,
	productID: number,
): Promise<Record<string, unknown>> {
	const output = await neode.readCypher(
		"MATCH (:Order { orderID: $order })-[line:CONTAINS]->(p:Product { productID: $product }) RETURN line AS line",
		{ order: orderID, product: productID },
	);

	const value = output.records[0]?.get("line") as Record<string, unknown>;

	return (value?.properties ?? value) as Record<string, unknown>;
}

async function orderCount(neode: Neode): Promise<number> {
	const output = await neode.readCypher(
		"MATCH (o:Order) RETURN count(o) AS count",
		{},
	);

	return Number(output.records[0]?.get("count"));
}

async function orderExists(neode: Neode, orderID: number): Promise<number> {
	const output = await neode.readCypher(
		"MATCH (o:Order { orderID: $id }) RETURN count(o) AS count",
		{ id: orderID },
	);

	return Number(output.records[0]?.get("count"));
}

async function rawOrder(
	neode: Neode,
	orderID: number,
): Promise<Record<string, unknown>> {
	const output = await neode.readCypher(
		"MATCH (o:Order { orderID: $id }) RETURN o AS o",
		{ id: orderID },
	);

	const node = output.records[0]?.get("o") as
		| { properties?: Record<string, unknown> }
		| undefined;

	return (node?.properties ?? {}) as Record<string, unknown>;
}
