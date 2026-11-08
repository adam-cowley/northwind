import Neode, { Builder, RawExpression, runCypherScript } from "neode";
import { Category } from "../models/category.js";
import { Customer } from "../models/customer.js";
import { Employee } from "../models/employee.js";
import { Order } from "../models/order.js";
import { Product } from "../models/product.js";
import { Region } from "../models/map-models/region.js";
import { Shipper } from "../models/shipper.js";
import { Supplier } from "../models/supplier.js";
import { Territory } from "../models/map-models/territory.js";
import { loadDataset } from "./dataset.js";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The map-API virtual classes are constructors at runtime; their static
// type through the built typings is the loose Newable record
const RegionModel = Region as unknown as new () => object;
const TerritoryModel = Territory as unknown as new () => object;

/**
Idempotent Northwind seed: every step MERGEs on business keys, so
re-running converges to the same graph (verified by the seed test).
Embeddings are computed by the library from `name` (the @Vector
provider); points convert from { latitude, longitude }.
*/

export interface SeedStats {
	regions: number;
	territories: number;
	categories: number;
	shippers: number;
	suppliers: number;
	employees: number;
	customers: number;
	products: number;
	orders: number;
	lines: number;
	bestsellers: number;
}

/** The demo's runCypherScript showcase: label the 10 most-ordered products. */
export const BESTSELLER_SCRIPT = `// Deterministic read-model labels, applied server-side.
MATCH (p:Product)<-[line:CONTAINS]-()
WITH p, sum(line.quantity) AS ordered
ORDER BY ordered DESC
LIMIT 10
SET p:Bestseller
RETURN count(p) AS bestsellers;
`;

export async function writeBestsellerScript(): Promise<string> {
	const path = join(dirname(fileURLToPath(import.meta.url)), "seed.cypher");

	writeFileSync(path, BESTSELLER_SCRIPT);

	return path;
}

export async function seed(
	neode: Neode,
	options: { syntheticOrders?: number } = {},
): Promise<SeedStats> {
	const data = loadDataset();

	// 1. Schema: constraints + range/text/fulltext/vector indexes from the models
	await neode.installSchema();

	// 2. Small reference graphs — mergeMany on merge fields, then relate
	await neode.mergeMany(RegionModel, data.regions);
	await neode.mergeMany(TerritoryModel, data.territories);
	await neode.mergeMany(Category, data.categories);
	await neode.mergeMany(Shipper, data.shippers);
	await neode.mergeMany(Supplier, data.suppliers);
	await neode.mergeMany(Employee, data.employees);
	await neode.mergeMany(Customer, data.customers);

	// 3. Products one-by-one in one transaction — the write path computes
	//    each embedding from the name (the bulk UNWIND path cannot SET
	//    vector-backed properties: library shortcut, bulk.service.ts) —
	//    then relate SUPPLIED_BY/PART_OF from the dataset's foreign keys
	await neode.inWriteTransaction(async (txProducts) => {
		for (const product of data.products) {
			const productID = product["productID"] as number;

			const existing = await txProducts.find(Product, productID);

			if (existing === undefined) {
				await txProducts.save(Object.assign(new Product(), product));
			}

			const productEntity = await txProducts.find(Product, productID);

			if (productEntity === undefined) {
				continue;
			}

			const supplier = await txProducts.find(
				Supplier,
				product["supplierID"] as number,
			);
			if (supplier !== undefined) {
				await txProducts.relate(Product, productEntity, supplier, "suppliedBy");
			}

			const category = await txProducts.find(
				Category,
				product["categoryID"] as number,
			);
			if (category !== undefined) {
				await txProducts.relate(Product, productEntity, category, "partOf");
			}
		}

		await txProducts.commit();
	});

	// 4. Territory/Employee relationships (map-model targets)
	await relateReferenceEdges(neode, data);

	// 5. Orders: nodes via mergeMany, then every relationship + line in one tx
	const orderRows = data.orders.map((order) => ({ ...order }));

	await neode.mergeMany(Order, orderRows as Record<string, unknown>[]);

	const linesByOrder = new Map<number, typeof data.orderLines>();
	for (const line of data.orderLines) {
		const lines = linesByOrder.get(line.orderID) ?? [];

		lines.push(line);
		linesByOrder.set(line.orderID, lines);
	}

	await neode.inWriteTransaction(async (txOrders) => {
		for (const order of data.orders) {
			const orderEntity = await txOrders.find(Order, order.orderID);

			if (orderEntity === undefined) {
				continue;
			}

			const customer =
				order.customerID === ""
					? undefined
					: await txOrders.find(Customer, order.customerID);
			if (customer !== undefined) {
				await txOrders.relate(Order, orderEntity, customer, "placedBy");
			}

			const employee = await txOrders.find(Employee, order.employeeID);
			if (employee !== undefined) {
				await txOrders.relate(Order, orderEntity, employee, "takenBy");
			}

			const shipper = await txOrders.find(Shipper, order.shipperID);
			if (shipper !== undefined) {
				await txOrders.relate(Order, orderEntity, shipper, "shippedVia");
			}

			for (const line of linesByOrder.get(order.orderID) ?? []) {
				const product = await txOrders.find(Product, line.productID);

				if (product === undefined) {
					continue;
				}

				await txOrders.relate(Order, orderEntity, product, "lines", {
					unitPrice: line.unitPrice,
					quantity: line.quantity,
					discount: line.discount,
				});
			}
		}

		await txOrders.commit();
	});

	// 6. The Cypher-script step: :Bestseller labels
	const path = await writeBestsellerScript();
	const results = await runCypherScript(
		neode.getRunner(),
		await (await import("node:fs/promises")).readFile(path, "utf8"),
	);
	const bestsellers = Number(
		results[results.length - 1]?.records?.[0]?.get("bestsellers") ?? 0,
	);

	// 7. Optional factory-generated volume
	if (options.syntheticOrders && options.syntheticOrders > 0) {
		await seedSyntheticOrders(neode, options.syntheticOrders);
	}

	return {
		regions: data.regions.length,
		territories: data.territories.length,
		categories: data.categories.length,
		shippers: data.shippers.length,
		suppliers: data.suppliers.length,
		employees: data.employees.length,
		customers: data.customers.length,
		products: data.products.length,
		orders: data.orders.length,
		lines: data.orderLines.length,
		bestsellers,
	};
}

async function relateReferenceEdges(
	neode: Neode,
	data: Awaited<ReturnType<typeof loadDataset>>,
): Promise<void> {
	await neode.inWriteTransaction(async (tx) => {
		for (const { territoryID, regionID } of data.territories) {
			const territory = await tx.find(TerritoryModel, territoryID);
			const region = await tx.find(RegionModel, regionID);

			if (territory !== undefined && region !== undefined) {
				await tx.relate(TerritoryModel, territory, region, "IN_REGION");
			}
		}

		for (const { employeeID, territoryID } of data.employeeTerritories) {
			const employee = await tx.find(Employee, employeeID);
			const territory = await tx.find(TerritoryModel, territoryID);

			if (employee !== undefined && territory !== undefined) {
				await tx.relate(Employee, employee, territory, "covers");
			}
		}

		// The seed owns this relationship's shape: clear stale edges from
		// earlier direction bugs, then relate employee → manager
		await tx.writeCypher("MATCH ()-[r:REPORTS_TO]->() DELETE r", {});

		for (const { employeeID, reportsTo } of data.employeeManagers) {
			const employee = await tx.find(Employee, employeeID);
			const manager = await tx.find(Employee, reportsTo);

			if (employee !== undefined && manager !== undefined) {
				await tx.relate(Employee, employee, manager, "reportsToRel");
			}
		}

		await tx.commit();
	});
}

/**
FactoryBuilder showcase: N synthetic orders layered on the real data —
random customer/employee/shipper, 1-4 random product lines, dates spread
across 1997. Sequential ids continue past the real max.
*/
export async function seedSyntheticOrders(
	neode: Neode,
	count: number,
): Promise<void> {
	const data = loadDataset();

	const random = mulberry32(1997);

	const pick = <T>(rows: T[]): T => rows[Math.floor(random() * rows.length)]!;

	// The graph is the truth: orders placed through the API since the seed
	// occupy dataset IDs too (the load test ran after real orders)
	const maxOutput = await neode.readCypher(
		"MATCH (o:Order) RETURN max(o.orderID) AS max",
		{},
	);

	const maxReal = Number(maxOutput.records[0]?.get("max") ?? 10247);

	// Build the rows first (deterministic), then write in chunks: ONE
	// UNWIND statement per chunk drives the whole batch — nodes, the three
	// relationships and the CONTAINS lines (NTS-526). No stock decrements:
	// inventory reflects the real dataset; the factory orders are extra
	// history for load-testing.
	const rows = [];

	for (let index = 1; index <= count; index++) {
		const customer = pick(data.customers);
		const orderDate = `1997-${String(1 + Math.floor(random() * 12)).padStart(2, "0")}-${String(1 + Math.floor(random() * 28)).padStart(2, "0")}T00:00:00Z`;

		const orderLines = [];
		const lineCount = 1 + Math.floor(random() * 4);

		for (let line = 0; line < lineCount; line++) {
			orderLines.push({
				productID: pick(data.products)["productID"],
				quantity: 1 + Math.floor(random() * 20),
				discount: 0,
			});
		}

		rows.push({
			orderID: maxReal + index,
			orderDate,
			requiredDate: orderDate,
			createdAt: orderDate,
			freight: Math.round(random() * 20000) / 100,
			shipName: customer["companyName"],
			shipStreet: customer["street"],
			shipCity: customer["city"],
			shipRegion: customer["region"],
			shipPostalCode: customer["postalCode"],
			shipCountry: customer["country"],
			customerID: customer["customerID"],
			employeeID: pick(data.employees)["employeeID"],
			shipperID: pick(data.shippers)["shipperID"],
			lines: orderLines,
		});
	}

	// Absent customer fields stay absent — undefined keys refuse to bind
	const compacted = rows.map((row) =>
		Object.fromEntries(
			Object.entries(row).filter(([, value]) => value !== undefined),
		),
	);

	const CHUNK = 500;

	for (let offset = 0; offset < compacted.length; offset += CHUNK) {
		const chunk = compacted.slice(offset, offset + CHUNK);

		await neode.inWriteTransaction(async (tx) => {
			const builder = new Builder();

			builder
				.unwind("$rows", "row")
				.match("c", "Customer", {
					customerID: new RawExpression("row.customerID"),
				})
				.match("e", "Employee", {
					employeeID: new RawExpression("row.employeeID"),
				})
				.match("s", "Shipper", {
					shipperID: new RawExpression("row.shipperID"),
				})
				.create("o", "Order", {
					orderID: new RawExpression("row.orderID"),
					orderDate: new RawExpression("row.orderDate"),
					requiredDate: new RawExpression("row.requiredDate"),
					createdAt: new RawExpression("row.createdAt"),
					freight: new RawExpression("row.freight"),
					shipName: new RawExpression("row.shipName"),
					shipStreet: new RawExpression("row.shipStreet"),
					shipCity: new RawExpression("row.shipCity"),
					shipRegion: new RawExpression("row.shipRegion"),
					shipPostalCode: new RawExpression("row.shipPostalCode"),
					shipCountry: new RawExpression("row.shipCountry"),
				})
				.relationship("PLACED_BY", "out")
				.to("c")
				.create("o")
				.relationship("TAKEN_BY", "out")
				.to("e")
				.create("o")
				.relationship("SHIPPED_VIA", "out")
				.to("s");

			builder.forEach("item", "row.lines", (sub) => {
				sub
					.merge("p", "Product", {
						productID: new RawExpression("item.productID"),
					})
					.create("o")
					.relationship("CONTAINS", "out", "line", undefined, {
						unitPrice: new RawExpression("p.unitPrice"),
						quantity: new RawExpression("item.quantity"),
						discount: new RawExpression("item.discount"),
					})
					.to("p");

				return sub;
			});

			builder.return("count(o) AS created");

			await tx.write(builder, { rows: chunk });

			await tx.commit();
		});
	}
}

/** Deterministic PRNG so the synthetic seed is reproducible. */
function mulberry32(seed: number): () => number {
	let state = seed;

	return () => {
		state |= 0;
		state = (state + 0x6d2b79f5) | 0;
		let result = Math.imul(state ^ (state >>> 15), 1 | state);

		result =
			(result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;

		return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
	};
}

/** Count what's actually in the graph — the seed's self-check. */
export async function graphCounts(
	neode: Neode,
): Promise<Record<string, number>> {
	const output = await neode.readCypher(
		"MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS count",
		{},
	);

	const counts: Record<string, number> = {};

	for (const row of output.records) {
		counts[String(row.get("label"))] = Number(row.get("count"));
	}

	return counts;
}
