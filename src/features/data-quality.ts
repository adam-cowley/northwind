import { Hono } from "hono";
import { withErrorMap } from "../api/errors.js";
import type Neode from "neode";
import { Builder } from "neode";

/**
NTS-536 — Data quality: orphans and hygiene via NEGATIVE graph patterns.
Five checks, each its own Builder query returning a count + up to 20
example strings. All insight features follow this file's shape:

- ONE file owning its service queries + its Hono sub-app
- Factory: `create<Feature>Routes(neode: Neode): Hono`
- Mounted by app.ts with `app.route("/api/insight", create…Routes(neode))`
- The auth guard in app.ts covers the mounted routes

Pattern probe against the embedded Relate engine (NTS-536): the raw
pattern predicate `WHERE NOT (x)<-[:TYPE]-()` and the implicit-import
`NOT EXISTS { MATCH … }` are both correct; the OPTIONAL MATCH +
`WHERE x IS NULL` idiom silently mis-filters (returns nothing even when
orphans exist), and the Builder's `existsExpr(…, [alias])` WITH-import
form mis-scopes. The raw pattern predicate below is the winning shape —
no user values flow into these patterns, so nothing needs parameterising.
*/

interface QualityCheck {
	readonly id: string;
	readonly label: string;
	readonly alias: string;
	readonly nodeLabel: string;
	/** Negative pattern anchored on the alias. */
	readonly missing: string;
	/** Cypher expression producing the example strings. */
	readonly example: string;
}

const CHECKS: QualityCheck[] = [
	{
		id: "neverOrdered",
		label: "Products never ordered",
		alias: "p",
		nodeLabel: "Product",
		missing: "(p)<-[:CONTAINS]-()",
		example: "p.name",
	},
	{
		id: "silentCustomers",
		label: "Customers with no orders",
		alias: "c",
		nodeLabel: "Customer",
		missing: "(c)<-[:PLACED_BY]-()",
		example: "c.companyName",
	},
	{
		id: "nakedTerritories",
		label: "Territories with no employee coverage",
		alias: "t",
		nodeLabel: "Territory",
		missing: "(t)<-[:COVERS]-()",
		example: "t.name",
	},
	{
		id: "supplierlessProducts",
		label: "Products with no supplier",
		alias: "p",
		nodeLabel: "Product",
		missing: "(p)-[:SUPPLIED_BY]->()",
		example: "p.name",
	},
	{
		id: "emptyOrders",
		label: "Orders with no lines",
		alias: "o",
		nodeLabel: "Order",
		missing: "(o)-[:CONTAINS]->()",
		example: "toString(o.orderID)",
	},
];

const EXAMPLE_CAP = 20;

async function runCheck(neode: Neode, check: QualityCheck) {
	const builder = new Builder();

	builder.match(check.alias, check.nodeLabel);
	builder.whereRaw(`NOT ${check.missing}`);
	builder.return(
		`count(${check.alias}) AS count`,
		`collect(${check.example}) AS examples`,
	);

	const output = await neode.read(builder);
	const row = output.records[0];

	return {
		id: check.id,
		label: check.label,
		count: Number(row?.get("count") ?? 0),
		examples: ((row?.get("examples") as unknown[] | undefined) ?? [])
			.slice(0, EXAMPLE_CAP)
			.map((value) => String(value)),
	};
}

export function createDataQualityRoutes(neode: Neode): Hono {
	const routes = withErrorMap(new Hono());

	routes.get("/quality", async (context) => {
		const checks = await Promise.all(
			CHECKS.map((check) => runCheck(neode, check)),
		);

		return context.json({ checks });
	});

	return routes;
}
