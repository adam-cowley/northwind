import { Hono } from "hono";
import { withErrorMap } from "../api/errors.js";
import type Neode from "neode";
import { Builder } from "neode";

/**
NTS-533 — Category affinity: which categories are bought together.
For every ordered pair of distinct categories, the number of orders
containing products from both, ranked. All insight features follow
basket-twins' shape:

- ONE file owning its service queries + its Hono sub-app
- Factory: `create<CategoryAffinity>Routes(neode: Neode): Hono`
- Mounted by app.ts with `app.route("/api/insight", create…Routes(neode))`
- Every value parameterised; numerics coerced with `Number()`
*/
export function createCategoryAffinityRoutes(neode: Neode): Hono {
	const routes = withErrorMap(new Hono());

	routes.get("/affinity", async (context) => {
		const builder = new Builder();

		builder.match("cA", "Category");
		builder.relationship("PART_OF", "in", "rpA").to("pA", "Product");
		builder.relationship("CONTAINS", "in", "rcA").to("o", "Order");
		builder.relationship("CONTAINS", "out", "rcB").to("pB", "Product");
		builder.relationship("PART_OF", "out", "rpB").to("cB", "Category");
		builder.whereRaw("cA <> cB");
		builder.return(
			"cA.name AS categoryA",
			"cB.name AS categoryB",
			"count(DISTINCT o) AS sharedOrders",
		);
		builder.orderBy("sharedOrders", "DESC");

		const { query, params } = builder.build();
		const output = await neode.readCypher(query, params);

		const pairs = output.records.map((row) => ({
			categoryA: String(row.get("categoryA")),
			categoryB: String(row.get("categoryB")),
			sharedOrders: Number(row.get("sharedOrders")),
		}));

		return context.json({ pairs });
	});

	return routes;
}
