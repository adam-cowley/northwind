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

interface ProductRef {
	id: number | null;
	name: string | null;
	stock: number | null;
}

interface CustomerRef {
	id: string | null;
	company: string | null;
	country: string | null;
}

export function createSupplyExposureRoutes(neode: Neode): Hono {
	const routes = withErrorMap(new Hono());

	// Ranked exposure for every supplier (OPTIONAL MATCH keeps suppliers
	// whose products were never ordered, at zero)
	routes.get("/supply-exposure", async (context) => {
		const builder = new Builder();

		builder.optionalMatch("s", "Supplier");
		builder
			.relationship("SUPPLIED_BY", "in", "rs")
			.to("p", "Product")
			.relationship("CONTAINS", "in", "rc")
			.to("o", "Order")
			.relationship("PLACED_BY", "out", "ro")
			.to("c", "Customer");

		builder.return(
			"s.supplierID AS id",
			"s.companyName AS company",
			"s.country AS country",
			"count(DISTINCT p) AS products",
			"count(DISTINCT o) AS orders",
			"count(DISTINCT c) AS customers",
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

		builder.optionalMatch("s");
		builder.relationship("SUPPLIED_BY", "in", "rs").to("p", "Product");
		builder.with(
			"s",
			"collect({id: p.productID, name: p.name, stock: p.unitsInStock}) AS products",
		);

		builder.optionalMatch("s");
		builder
			.relationship("SUPPLIED_BY", "in", "rs2")
			.to("p2", "Product")
			.relationship("CONTAINS", "in", "rc")
			.to("o", "Order")
			.relationship("PLACED_BY", "out", "ro")
			.to("c", "Customer");

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
			"products",
			"count(DISTINCT o) AS orders",
			"collect(DISTINCT {id: c.customerID, company: c.companyName, country: c.country}) AS customers",
		);

		const output = await neode.read(builder);

		const row = output.records[0];

		// An unmatched row still comes back with s = null when the supplier
		// does not exist — treat it as 404 (null maps in the collects are
		// filtered below)
		if (row === undefined || row.get("id") === null) {
			return context.json(
				{ error: `Supplier ${context.req.param("supplierId")} not found` },
				404,
			);
		}

		const products = (row.get("products") as ProductRef[])
			.filter((product) => product.id !== null)
			.map((product) => ({
				id: Number(product.id),
				name: String(product.name),
				stock: Number(product.stock),
			}));

		const customers = (row.get("customers") as CustomerRef[])
			.filter((customer) => customer.id !== null)
			.map((customer) => ({
				id: String(customer.id),
				company: String(customer.company),
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
