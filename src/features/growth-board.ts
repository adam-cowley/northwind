import { Hono } from "hono";
import { withErrorMap } from "../api/errors.js";
import type Neode from "neode";
import { Builder } from "neode";

/**
NTS-535 — Growth board: month-over-month risers and fallers per product.
ONE Builder query returns the per-product-per-month revenue series; the
MoM deltas are computed in TypeScript and ranked for the requested month
(default: the max month with data). All insight features follow the
basket-twins file's shape:

- ONE file owning its service queries + its Hono sub-app
- Factory: `create<Feature>Routes(neode: Neode): Hono`
- Mounted by app.ts with `app.route("/api/insight", create…Routes(neode))`
- Every value parameterised; numerics coerced with `Number()`
*/
export function createGrowthBoardRoutes(neode: Neode): Hono {
	const routes = withErrorMap(new Hono());

	routes.get("/growth", async (context) => {
		const limitParam = Number(context.req.query("limit") ?? 5);
		const limit = Number.isFinite(limitParam)
			? Math.max(0, Math.trunc(limitParam))
			: 5;

		const builder = new Builder();

		builder
			.match("p", "Product")
			.relationship("CONTAINS", "in", "line")
			.to("o", "Order")
			.return(
				"p.productID AS productID",
				"p.name AS name",
				"substring(toString(o.orderDate), 0, 7) AS month",
				"round(sum(line.quantity * line.unitPrice * (1 - line.discount))) AS revenue",
			);

		const { query, params } = builder.build();
		const output = await neode.readCypher(query, params);

		// Fold the rows into productID -> { name, month -> revenue }
		const series = new Map<
			number,
			{ name: string; byMonth: Map<string, number> }
		>();
		for (const row of output.records) {
			const productID = Number(row.get("productID"));
			const entry = series.get(productID) ?? {
				name: String(row.get("name")),
				byMonth: new Map<string, number>(),
			};
			entry.byMonth.set(String(row.get("month")), Number(row.get("revenue")));
			series.set(productID, entry);
		}

		const requested = context.req.query("month");
		if (requested !== undefined && !/^\d{4}-\d{2}$/.test(requested)) {
			return context.json({ error: "month must be YYYY-MM" }, 400);
		}

		const months = [...series.values()].flatMap((entry) => [
			...entry.byMonth.keys(),
		]);
		const month = requested ?? [...months].sort().at(-1) ?? null;
		if (month === null) {
			return context.json({ month: null, risers: [], fallers: [] });
		}

		const previous = previousMonth(month);

		interface Movement {
			productID: number;
			name: string;
			month: string;
			revenue: number;
			previousRevenue: number;
			delta: number;
		}
		const risers: Movement[] = [];
		const fallers: Movement[] = [];

		for (const [productID, { name, byMonth }] of series) {
			const revenue = byMonth.get(month);
			if (revenue === undefined) continue;
			const previousRevenue = byMonth.get(previous) ?? 0;
			const delta = revenue - previousRevenue;
			const movement = {
				productID,
				name,
				month,
				revenue,
				previousRevenue,
				delta,
			};
			if (delta > 0) risers.push(movement);
			else if (delta < 0) fallers.push(movement);
		}

		risers.sort((a, b) => b.delta - a.delta);
		fallers.sort((a, b) => a.delta - b.delta);

		return context.json({
			month,
			risers: risers.slice(0, limit),
			fallers: fallers.slice(0, limit),
		});
	});

	return routes;
}

/** The calendar month before "1997-03" — "1997-02" (rolls across years). */
function previousMonth(month: string): string {
	const date = new Date(
		Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1),
	);
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
