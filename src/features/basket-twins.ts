import { Hono } from "hono";
import { withErrorMap } from "../api/errors.js";
import type Neode from "neode";
import { Builder, NeodeError } from "neode";

/**
NTS-531 — Basket twins: customers sharing the most products with the
given customer (Jaccard over distinct-product baskets), via Builder
aggregations. All insight features follow this file's shape:

- ONE file owning its service queries + its Hono sub-app
- Factory: `create<Feature>Routes(neode: Neode): Hono`
- Mounted by app.ts with `app.route("/api/insight", create…Routes(neode))`
- The auth guard in app.ts covers the mounted routes
- Every value parameterised; temporals coerced with `+`/`Number()`
*/
export function createBasketTwinsRoutes(neode: Neode): Hono {
	const routes = withErrorMap(new Hono());

	routes.get("/twins/:customerId", async (context) => {
		const customerId = context.req.param("customerId");

		const builder = new Builder();

		builder
			.match("c", "Customer", { customerID: customerId })
			.relationship("PLACED_BY", "in", "ro1")
			.to("o1", "Order")
			.relationship("CONTAINS", "out", "rc1")
			.to("p1", "Product")
			.with("c", "collect(DISTINCT p1) AS mine");

		builder.match("other", "Customer");
		builder
			.relationship("PLACED_BY", "in", "ro2")
			.to("o2", "Order")
			.relationship("CONTAINS", "out", "rc2")
			.to("p2", "Product");
		builder.whereRaw("other <> c");
		builder.whereRaw("p2 IN mine");
		builder.with("c", "mine", "other", "collect(DISTINCT p2) AS shared");

		builder.match("other", "Customer");
		builder
			.relationship("PLACED_BY", "in", "ro3")
			.to("o3", "Order")
			.relationship("CONTAINS", "out", "rc3")
			.to("p3", "Product");
		builder.with(
			"c",
			"mine",
			"other",
			"shared",
			"count(DISTINCT p3) AS otherSize",
		);

		builder.return(
			"other.customerID AS id",
			"other.companyName AS company",
			"other.country AS country",
			"size(shared) AS sharedProducts",
			"size(mine) AS myProducts",
			"round(100.0 * size(shared) / (size(mine) + otherSize - size(shared))) AS jaccard",
		);
		builder.orderBy("jaccard", "DESC");
		builder.orderBy("sharedProducts", "DESC");
		builder.limit(10);

		const { query, params } = builder.build();
		const output = await neode.readCypher(query, params);

		const twins = output.records.map((row) => ({
			id: String(row.get("id")),
			company: String(row.get("company")),
			country: String(row.get("country")),
			sharedProducts: Number(row.get("sharedProducts")),
			myProducts: Number(row.get("myProducts")),
			jaccard: Number(row.get("jaccard")),
		}));

		if (twins.length === 0) {
			throw new NeodeError(
				`Customer ${customerId} has no order basket to compare`,
			);
		}

		return context.json({ customer: customerId, twins });
	});

	return routes;
}
