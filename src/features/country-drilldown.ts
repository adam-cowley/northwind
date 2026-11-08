import { Hono } from "hono";
import { withErrorMap } from "../api/errors.js";
import { LINE_REVENUE } from "../shared.js";
import type Neode from "neode";
import { Builder, NeodeError } from "neode";

/**
NTS-541b — Countries insight: which countries order what.

- GET /countries — per ship-to country: orders, revenue, distinct products
- GET /countries/:country — the product mix for one country, ranked by
  revenue (the drilldown), plus the top customers in that country

Every value parameterised; the country name binds as a parameter (the
property FILTER), never interpolated.
*/
export function createCountryRoutes(neode: Neode): Hono {
	const routes = withErrorMap(new Hono());

	routes.get("/countries", async (context) => {
		const builder = new Builder();

		builder
			.match("o", "Order")
			.relationship("CONTAINS", "out", "line")
			.to("p", "Product")
			.return(
				"o.shipCountry AS country",
				"count(DISTINCT o) AS orders",
				`round(sum(${LINE_REVENUE})) AS revenue`,
				"count(DISTINCT p) AS products",
			)
			.orderBy("revenue", "DESC");

		const { query, params } = builder.build();
		const output = await neode.readCypher(query, params);

		const countries = output.records
			.map((row) => ({
				country:
					row.get("country") === null
						? "(unknown)"
						: String(row.get("country")),
				orders: Number(row.get("orders")),
				revenue: Number(row.get("revenue")),
				products: Number(row.get("products")),
			}))
			.filter((row) => row.country !== "(unknown)");

		return context.json({ countries });
	});

	routes.get("/countries/:country", async (context) => {
		const country = context.req.param("country");

		if (country === "" || country === "(unknown)") {
			throw new NeodeError("Give a real country name");
		}

		const builder = new Builder();

		builder
			.match("o", "Order", { shipCountry: country })
			.relationship("CONTAINS", "out", "line")
			.to("p", "Product")
			.return(
				"p.productID AS productID",
				"p.name AS name",
				"count(DISTINCT o) AS orders",
				`round(sum(${LINE_REVENUE})) AS revenue`,
			)
			.orderBy("revenue", "DESC")
			.limit(25);

		const { query, params } = builder.build();
		const productMix = await neode.readCypher(query, params);

		return context.json({
			country,
			products: productMix.records.map((row) => ({
				productID: Number(row.get("productID")),
				name: String(row.get("name")),
				orders: Number(row.get("orders")),
				revenue: Number(row.get("revenue")),
			})),
		});
	});

	return routes;
}
