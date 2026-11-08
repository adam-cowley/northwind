import { Hono } from "hono";
import { withErrorMap } from "../api/errors.js";
import type Neode from "neode";
import { Builder } from "neode";

/**
NTS-538 — Reorder network: the "who do I call" list for low stock.
Products at or below their reorder level, grouped by supplier, each with
the count of open (unshipped) orders containing it. Two Builder queries —
the low-stock list and the open-order counts — joined in TypeScript.
Insight features follow this file's shape (see basket-twins.ts):

- ONE file owning its service queries + its Hono sub-app
- Factory: `create<Feature>Routes(neode: Neode): Hono`
- Mounted by app.ts with `app.route("/api/insight", create…Routes(neode))`
- Every value parameterised; numerics coerced with `Number()`
*/
interface ReorderProduct {
	productID: number;
	name: string;
	stock: number;
	reorderLevel: number;
	unitsOnOrder: number;
	openOrders: number;
}

interface ReorderSupplier {
	supplierID: number;
	company: string;
	phone: string;
	country: string;
	products: ReorderProduct[];
}

export function createReorderNetworkRoutes(neode: Neode): Hono {
	const routes = withErrorMap(new Hono());

	routes.get("/reorder-network", async (context) => {
		// Query 1 — low-stock products with their supplier
		const lowStock = new Builder();
		lowStock
			.match("p", "Product")
			.whereRaw("p.unitsInStock <= p.reorderLevel")
			.relationship("SUPPLIED_BY", "out", "sr")
			.to("s", "Supplier")
			.return(
				"p.productID AS productID",
				"p.name AS name",
				"p.unitsInStock AS stock",
				"p.reorderLevel AS reorderLevel",
				"p.unitsOnOrder AS unitsOnOrder",
				"s.supplierID AS supplierID",
				"s.companyName AS company",
				"s.phone AS phone",
				"s.country AS country",
			)
			.orderBy("s.companyName", "ASC")
			.orderBy("p.name", "ASC");

		// Query 2 — open (unshipped) orders per product
		const openOrders = new Builder();
		openOrders
			.match("p", "Product")
			.relationship("CONTAINS", "in", "ro")
			.to("o", "Order")
			.whereRaw("o.shippedDate IS NULL")
			.return("p.productID AS productID", "count(DISTINCT o) AS openOrders");

		const lowStockQuery = lowStock.build();
		const openOrdersQuery = openOrders.build();
		const [lowStockOutput, openOrdersOutput] = await Promise.all([
			neode.readCypher(lowStockQuery.query, lowStockQuery.params),
			neode.readCypher(openOrdersQuery.query, openOrdersQuery.params),
		]);

		const openByProduct = new Map<number, number>();
		for (const row of openOrdersOutput.records) {
			openByProduct.set(
				Number(row.get("productID")),
				Number(row.get("openOrders")),
			);
		}

		const suppliers = new Map<number, ReorderSupplier>();
		for (const row of lowStockOutput.records) {
			const supplierID = Number(row.get("supplierID"));

			let supplier = suppliers.get(supplierID);
			if (supplier === undefined) {
				supplier = {
					supplierID,
					company: String(row.get("company")),
					phone: String(row.get("phone")),
					country: String(row.get("country")),
					products: [],
				};
				suppliers.set(supplierID, supplier);
			}

			const productID = Number(row.get("productID"));
			supplier.products.push({
				productID,
				name: String(row.get("name")),
				stock: Number(row.get("stock")),
				reorderLevel: Number(row.get("reorderLevel")),
				unitsOnOrder: Number(row.get("unitsOnOrder")),
				openOrders: openByProduct.get(productID) ?? 0,
			});
		}

		return context.json({ suppliers: [...suppliers.values()] });
	});

	return routes;
}
