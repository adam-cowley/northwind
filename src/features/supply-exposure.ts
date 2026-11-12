import { Hono } from "hono";
import { withErrorMap } from "../api/errors.js";
import type Neode from "neode";
import { Builder } from "neode";

/**
NTS-532 — Supply-chain exposure: who is at risk if supplier X goes down.
For each supplier: their products, the distinct orders carrying those
products, and the distinct customers behind those orders — ranked
most-dependent first. All insight features follow this file's shape:

- ONE file owning its service queries + its Hono sub-app
- Factory: `create<Feature>Routes(neode: Neode): Hono`
- Mounted by app.ts with `app.route("/api/insight", create…Routes(neode))`
- The auth guard in app.ts covers the mounted routes
- Every value parameterised; temporals coerced with `+`/`Number()`

Traversal: (Supplier)<-[:SUPPLIED_BY]-(Product)<-[CONTAINS]-(Order)
-[:PLACED_BY]->(Customer).
*/

/** Null-safe text for optional supplier fields (region may be absent). */
function text(value: unknown): string {
	return value === null || value === undefined ? "" : String(value);
}

export function createSupplyExposureRoutes(neode: Neode): Hono {
	const routes = withErrorMap(new Hono());

	// Ranked exposure for every supplier. COUNT {} subqueries keep suppliers
	// whose products were never ordered (they count 0) with no row
	// fan-out — the house doctrine instead of OPTIONAL MATCH (NTS-565).
	routes.get("/supply-exposure", async (context) => {
		const builder = new Builder();

		builder.match("s", "Supplier");
		builder.countSubquery("products", (sub) =>
			sub.match("s").relationship("SUPPLIED_BY", "in").to("p", "Product"),
		);
		builder.countSubquery("orders", (sub) =>
			sub
				.match("s")
				.relationship("SUPPLIED_BY", "in")
				.to("p", "Product")
				.relationship("CONTAINS", "in")
				.to("o", "Order"),
		);
		builder.countSubquery("customers", (sub) =>
			sub
				.match("s")
				.relationship("SUPPLIED_BY", "in")
				.to("p", "Product")
				.relationship("CONTAINS", "in")
				.to("o", "Order")
				.relationship("PLACED_BY", "out")
				.to("c", "Customer")
				// distinct customers: one customer placing many orders carrying
				// the supplier's products counts once
				.return("DISTINCT c AS customer"),
		);
		builder.return(
			"s.supplierID AS id",
			"s.companyName AS company",
			"s.country AS country",
		);
		builder.orderBy("customers", "DESC");
		builder.orderBy("orders", "DESC");
		builder.orderBy("company", "ASC");

		const output = await neode.read(builder);

		const suppliers = output.records.map((row) => ({
			id: Number(row.get("id")),
			company: String(row.get("company")),
			country: String(row.get("country")),
			products: Number(row.get("products")),
			orders: Number(row.get("orders")),
			customers: Number(row.get("customers")),
		}));

		return context.json({ suppliers });
	});

	// Drill: one supplier's contact info + products + affected customers
	routes.get("/supply-exposure/:supplierId", async (context) => {
		const supplierId = Number(context.req.param("supplierId"));

		if (Number.isNaN(supplierId)) {
			return context.json({ error: "supplierId must be a number" }, 400);
		}

		const builder = new Builder();

		builder.match("s", "Supplier", { supplierID: supplierId });

		builder.return(
			"s.supplierID AS id",
			"s.companyName AS company",
			"s.contactName AS contactName",
			"s.contactTitle AS contactTitle",
			"s.phone AS phone",
			"s.street AS street",
			"s.city AS city",
			"s.region AS region",
			"s.country AS country",
			"s.postalCode AS postalCode",
			// pattern comprehension: no order needed, [] when the supplier
			// carries no products (house doctrine, NTS-565)
			"[(s)<-[:SUPPLIED_BY]-(p:Product) | p { .productID, .name, .unitsInStock }] AS products",
		);
		builder.countSubquery("orders", (sub) =>
			sub
				.match("s")
				.relationship("SUPPLIED_BY", "in")
				.to("p2", "Product")
				.relationship("CONTAINS", "in")
				.to("o", "Order"),
		);
		// DISTINCT customers come out of the COLLECT {} subquery — one row
		// per customer however many orders carried them
		builder.collectSubquery("customers", (sub) =>
			sub
				.match("s")
				.relationship("SUPPLIED_BY", "in")
				.to("p3", "Product")
				.relationship("CONTAINS", "in")
				.to("o2", "Order")
				.relationship("PLACED_BY", "out")
				.to("c", "Customer")
				.return(
					"DISTINCT c { .customerID, .companyName, .country } AS customer",
				),
		);

		const output = await neode.read(builder);

		const row = output.records[0];

		// A hard MATCH yields no rows for an unknown supplier — 404
		if (row === undefined) {
			return context.json(
				{ error: `Supplier ${context.req.param("supplierId")} not found` },
				404,
			);
		}

		const products = (
			row.get("products") as {
				productID: number;
				name: string;
				unitsInStock: number;
			}[]
		).map((product) => ({
			id: Number(product.productID),
			name: String(product.name),
			stock: Number(product.unitsInStock),
		}));

		const customers = (
			row.get("customers") as {
				customerID: string;
				companyName: string;
				country: string;
			}[]
		).map((customer) => ({
			id: String(customer.customerID),
			company: String(customer.companyName),
			country: String(customer.country),
		}));

		return context.json({
			supplier: {
				id: Number(row.get("id")),
				company: String(row.get("company")),
				contactName: text(row.get("contactName")),
				contactTitle: text(row.get("contactTitle")),
				phone: text(row.get("phone")),
				street: text(row.get("street")),
				city: text(row.get("city")),
				region: text(row.get("region")),
				country: text(row.get("country")),
				postalCode: text(row.get("postalCode")),
			},
			products,
			orders: Number(row.get("orders")),
			customers,
		});
	});

	return routes;
}
