import { Hono } from "hono";
import { withErrorMap } from "../api/errors.js";
import type Neode from "neode";

/**
NTS-534 — Product links: how are two products connected? Paths up to a
handful of hops between two products:

- shared order:      Product<-CONTAINS-Order-CONTAINS->Product
- shared supplier:   Product-SUPPLIED_BY->Supplier<-SUPPLIED_BY-Product
- shared customer:   Product<-CONTAINS-Order-PLACED_BY->Customer<-PLACED_BY-Order-CONTAINS->Product

All insight features follow basket-twins.ts's shape:

- ONE file owning its service queries + its Hono sub-app
- Factory: `create<Feature>Routes(neode: Neode): Hono`
- Mounted by app.ts with `app.route("/api/insight", create…Routes(neode))`
- The auth guard in app.ts covers the mounted routes
- Every value parameterised

The embedded engine supports shortestPath() (probed, NTS-534), so the two
2-edge connections use `shortestPath` over a type-restricted pattern. The
shared-customer connection cannot: a multi-type `shortestPath` happily
returns a customer-less Product-Order-Product-Order-Product chain, so it
pins the exact 4-edge pattern instead.
*/

/** One hop in a connection: the two node displays and the relationship between them. */
interface Hop {
	from: string;
	type: string;
	to: string;
}

interface Link {
	via: string;
	hops: Hop[];
}

/** Display for a path node — name where the graph has one, id otherwise. */
const DISPLAY = `CASE
	WHEN n.productID IS NOT NULL THEN n.name + ' (#' + toString(n.productID) + ')'
	WHEN n.orderID IS NOT NULL THEN 'Order #' + toString(n.orderID)
	WHEN n.supplierID IS NOT NULL THEN n.companyName + ' (#' + toString(n.supplierID) + ')'
	WHEN n.customerID IS NOT NULL THEN n.companyName + ' (' + n.customerID + ')'
	ELSE toString(labels(n)) END`;

const LINKS_CYPHER = `MATCH (a:Product {productID: $a}), (b:Product {productID: $b})
MATCH p = shortestPath((a)-[:CONTAINS*2]-(b))
WITH [n IN nodes(p) | ${DISPLAY}] AS names,
	[r IN relationships(p) | type(r)] AS types
RETURN 'shared-order' AS via, names, types
UNION
MATCH (a:Product {productID: $a}), (b:Product {productID: $b})
MATCH p = shortestPath((a)-[:SUPPLIED_BY*2]-(b))
WITH [n IN nodes(p) | ${DISPLAY}] AS names,
	[r IN relationships(p) | type(r)] AS types
RETURN 'shared-supplier' AS via, names, types
UNION
MATCH (a:Product {productID: $a})<-[:CONTAINS]-(o1:Order)-[:PLACED_BY]->
	(c:Customer)<-[:PLACED_BY]-(o2:Order)-[:CONTAINS]->(b:Product {productID: $b})
WITH [n IN [a, o1, c, o2, b] | ${DISPLAY}] AS names,
	['CONTAINS', 'PLACED_BY', 'PLACED_BY', 'CONTAINS'] AS types
RETURN 'shared-customer' AS via, names, types`;

export function createProductLinksRoutes(neode: Neode): Hono {
	const routes = withErrorMap(new Hono());

	routes.get("/links", async (context) => {
		const a = Number(context.req.query("a"));
		const b = Number(context.req.query("b"));

		// Same id is a degenerate "connection" — and unparseable ids simply
		// match nothing, so both collapse to the graceful empty list
		if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) {
			return context.json([] satisfies Link[]);
		}

		const output = await neode.readCypher(LINKS_CYPHER, { a, b });

		// The shared-customer pattern can match several order pairs; one
		// entry per via is the contract, so keep the first of each
		const seen = new Set<string>();
		const links: Link[] = [];

		for (const row of output.records) {
			const via = String(row.get("via"));

			if (seen.has(via)) continue;
			seen.add(via);

			const names = row.get("names") as string[];
			const types = row.get("types") as string[];

			links.push({
				via,
				hops: names.slice(0, -1).map((from, index) => ({
					from,
					type: types[index] ?? "",
					to: names[index + 1] ?? "",
				})),
			});
		}

		return context.json(links);
	});

	return routes;
}
