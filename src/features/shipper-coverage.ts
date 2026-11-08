import { Hono } from "hono";
import { withErrorMap } from "../api/errors.js";
import type Neode from "neode";
import { Builder } from "neode";

/**
NTS-537 — Shipper coverage: who ships where. Per-shipper totals
(orders shipped, revenue shipped over the order's CONTAINS lines,
distinct ship-to countries) plus a country × shipper dominance matrix.
All insight features follow basket-twins' shape:

- ONE file owning its service queries + its Hono sub-app
- Factory: `create<Feature>Routes(neode: Neode): Hono`
- Mounted by app.ts with `app.route("/api/insight", create…Routes(neode))`
- The auth guard in app.ts covers the mounted routes
- Every value parameterised; temporals coerced with `+`/`Number()`
*/
export function createShipperCoverageRoutes(neode: Neode): Hono {
	const routes = withErrorMap(new Hono());

	routes.get("/shippers", async (context) => {
		// Per-shipper aggregates: one hop out of each order's CONTAINS
		// lines for the revenue sum, one hop out to the ship-to country.
		const totalsBuilder = new Builder();

		totalsBuilder
			.match("s", "Shipper")
			.relationship("SHIPPED_VIA", "in")
			.to("o", "Order")
			.relationship("CONTAINS", "out", "rc")
			.to("p", "Product");
		totalsBuilder.return(
			"s.shipperID AS shipperID",
			"s.companyName AS name",
			"s.phone AS phone",
			"count(DISTINCT o) AS orders",
			"sum(rc.unitPrice * rc.quantity * (1 - rc.discount)) AS revenue",
			"count(DISTINCT o.shipCountry) AS countries",
		);
		totalsBuilder.orderBy("orders", "DESC");

		// Per-country totals: the top row per country (orders DESC) is
		// the dominant shipper — picked in TypeScript below.
		const dominanceBuilder = new Builder();

		dominanceBuilder
			.match("s", "Shipper")
			.relationship("SHIPPED_VIA", "in")
			.to("o", "Order");
		dominanceBuilder.return(
			"o.shipCountry AS country",
			"s.shipperID AS shipper",
			"count(o) AS orders",
		);
		dominanceBuilder.orderBy("country");
		dominanceBuilder.orderBy("orders", "DESC");

		const totalsQuery = totalsBuilder.build();
		const dominanceQuery = dominanceBuilder.build();

		const [totalsOutput, dominanceOutput] = await Promise.all([
			neode.readCypher(totalsQuery.query, totalsQuery.params),
			neode.readCypher(dominanceQuery.query, dominanceQuery.params),
		]);

		const shippers = totalsOutput.records.map((row) => ({
			shipperID: Number(row.get("shipperID")),
			name: String(row.get("name")),
			phone: String(row.get("phone")),
			orders: Number(row.get("orders")),
			revenue: Number(row.get("revenue")),
			countries: Number(row.get("countries")),
		}));

		// Rows are sorted country ASC, orders DESC — the first row seen
		// per country is that country's dominant shipper.
		const dominance: { country: string; shipper: number; orders: number }[] =
			[];
		for (const row of dominanceOutput.records) {
			const country = String(row.get("country"));
			if (dominance.some((winner) => winner.country === country)) {
				continue;
			}
			dominance.push({
				country,
				shipper: Number(row.get("shipper")),
				orders: Number(row.get("orders")),
			});
		}

		return context.json({ shippers, dominance });
	});

	return routes;
}
