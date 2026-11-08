import { Hono } from "hono";
import { withErrorMap } from "../api/errors.js";
import { LINE_REVENUE } from "../shared.js";
import type Neode from "neode";
import { Builder } from "neode";

/**
NTS-540 — Region rollup: revenue through the territory hierarchy.

(r:Region)<-[:IN_REGION]-(t:Territory)<-[:COVERS]-(emp:Employee)<-[:TAKEN_BY]-(o:Order)-[:CONTAINS]->(line)

One Builder query, staged with WITH so the aggregations stay honest:
an employee covering several territories in a region (and an order's
lines traversed once per matching row) would multiply raw rows and
inflate the revenue sum, so the distinct orders are collected and
unwound before their CONTAINS lines are summed. All insight features
follow basket-twins.ts's shape.
*/
export function createRegionRollupRoutes(neode: Neode): Hono {
	const routes = withErrorMap(new Hono());

	routes.get("/regions", async (context) => {
		const builder = new Builder();

		// Territories per region
		builder.match("r", "Region");
		builder.relationship("IN_REGION", "in", "ri1").to("t", "Territory");
		builder.with("r", "count(DISTINCT t) AS territories");

		// Employees covering any territory of the region
		builder.match("emp", "Employee");
		builder
			.relationship("COVERS", "out", "rc1")
			.to("t2", "Territory")
			.relationship("IN_REGION", "out", "ri2")
			.to("r");
		builder.with(
			"r",
			"territories",
			"collect(DISTINCT emp.firstName + ' ' + emp.lastName) AS employees",
		);

		// Distinct orders taken by those employees
		builder.match("o", "Order");
		builder
			.relationship("TAKEN_BY", "out", "rt1")
			.to("taker", "Employee")
			.relationship("COVERS", "out", "rc2")
			.to("t3", "Territory")
			.relationship("IN_REGION", "out", "ri3")
			.to("r");
		builder.with(
			"r",
			"territories",
			"employees",
			"collect(DISTINCT o) AS orderNodes",
		);

		// Unwind the deduped orders, then sum their lines exactly once each.
		// The CONTAINS edge carries the line state (OrderLine), so the
		// relationship alias is `line`; price it in its own WITH because the
		// engine returns 0 for sum(property * property) — sum the alias.
		builder.unwind("orderNodes", "o2");
		builder.match("o2");
		builder.relationship("CONTAINS", "out", "line").to("product");
		builder.with(
			"r",
			"territories",
			"employees",
			"o2",
			`${LINE_REVENUE} AS lineRevenue`,
		);
		builder.with(
			"r",
			"territories",
			"employees",
			"count(DISTINCT o2) AS orders",
			"sum(lineRevenue) AS revenue",
		);

		builder.return(
			"r.regionID AS regionID",
			"r.name AS name",
			"territories",
			"employees",
			"orders",
			"revenue",
		);
		builder.orderBy("revenue", "DESC");

		const output = await neode.read(builder);

		const regions = output.records.map((row) => ({
			regionID: Number(row.get("regionID")),
			name: String(row.get("name")),
			territories: Number(row.get("territories")),
			employees: (row.get("employees") as unknown[]).map((name) =>
				String(name),
			),
			orders: Number(row.get("orders")),
			revenue: Number(row.get("revenue")),
		}));

		return context.json({ regions });
	});

	return routes;
}
