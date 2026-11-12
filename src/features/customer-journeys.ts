import { Hono } from "hono";
import { withErrorMap } from "../api/errors.js";
import type Neode from "neode";
import { Builder, NeodeError, RawExpression } from "neode";

/**
NTS-539 — Customer journeys: what do customers buy AFTER their first
order? Per customer with ≥ 2 orders, pair the earliest order (first
basket) with the next one (next basket), then aggregate first-product →
next-product transitions across customers, ranked by how many customers
made each. All insight features follow basket-twins.ts's shape:

- ONE file owning its service queries + its Hono sub-app
- Factory: `create<CustomerJourneys>Routes(neode: Neode): Hono`
- Mounted by app.ts with `app.route("/api/insight", create…Routes(neode))`
- The auth guard in app.ts covers the mounted routes
- Every value parameterised; temporals coerced with `+`/`Number()`
*/
export function createCustomerJourneysRoutes(neode: Neode): Hono {
	const routes = withErrorMap(new Hono());

	routes.get("/journeys", async (context) => {
		// ONE statement (NTS-660): the per-customer first/second-order
		// pairs are collected server-side and UNWINDed inside a CALL
		// subquery — no JS-marshalled $journeys param, one roundtrip.
		const builder = new Builder();

		// Per customer with ≥ 2 orders: the earliest order and the next
		// one, ordered by date within the customer.
		builder.match("c", "Customer");
		builder.relationship("PLACED_BY", "in", "ro").to("o", "Order");
		builder.with("c", "o");
		builder.withOrder("o.orderDate");
		builder.with(
			"c",
			"collect(o)[0] AS firstOrder",
			"collect(o)[1] AS secondOrder",
		);
		builder.whereRaw("secondOrder IS NOT NULL");
		builder.with(
			"collect({ customerID: c.customerID, firstOrderID: firstOrder.orderID, secondOrderID: secondOrder.orderID }) AS journeys",
		);

		// Products of each pair's two orders → transition pairs ranked
		// by how many customers made the jump (a product repeated across
		// baskets is not a journey, so self-transitions are filtered).
		builder.call(
			(sub) =>
				sub
					.unwind("journeys", "journey")
					.match("f", "Order", {
						orderID: new RawExpression("journey.firstOrderID"),
					})
					.relationship("CONTAINS", "out", "rf")
					.to("fp", "Product")
					.match("s", "Order", {
						orderID: new RawExpression("journey.secondOrderID"),
					})
					.relationship("CONTAINS", "out", "rs")
					.to("sp", "Product")
					.whereRaw("fp.productID <> sp.productID")
					.return(
						"fp.productID AS fromProductID",
						"fp.name AS fromName",
						"sp.productID AS toProductID",
						"sp.name AS toName",
						"count(DISTINCT journey.customerID) AS customers",
					)
					.orderBy("customers", "DESC")
					.limit(15),
			["journeys"],
		);

		builder.return(
			"fromProductID",
			"fromName",
			"toProductID",
			"toName",
			"customers",
		);

		const ranking = await neode.read(builder);

		return context.json({
			transitions: ranking.records.map((row) => ({
				fromProductID: Number(row.get("fromProductID")),
				fromName: String(row.get("fromName")),
				toProductID: Number(row.get("toProductID")),
				toName: String(row.get("toName")),
				customers: Number(row.get("customers")),
			})),
		});
	});

	/**
	The drill (expand a transition): the actual customers + their two
	orders for ONE from → to transition.
	*/
	routes.get("/journeys/:fromProductID/:toProductID", async (context) => {
		const fromProductID = Number(context.req.param("fromProductID"));
		const toProductID = Number(context.req.param("toProductID"));

		if (!Number.isInteger(fromProductID) || !Number.isInteger(toProductID)) {
			throw new NeodeError("product ids must be integers");
		}

		const builder = new Builder();

		// The same per-customer first/second shape as the ranking, then
		// filter to the exact transition and return the people + orders
		builder.match("c", "Customer");
		builder.relationship("PLACED_BY", "in", "ro1").to("o1", "Order");
		builder.with("c", "o1");
		builder.withOrder("o1.orderDate");
		builder.with(
			"c",
			"collect(o1)[0] AS firstOrder",
			"collect(o1)[1] AS secondOrder",
		);
		builder.whereRaw("secondOrder IS NOT NULL");

		builder.match("first", "Order", {
			orderID: new RawExpression("firstOrder.orderID"),
		});
		builder.relationship("CONTAINS", "out", "lf").to("fp", "Product");
		builder.match("second", "Order", {
			orderID: new RawExpression("secondOrder.orderID"),
		});
		builder.relationship("CONTAINS", "out", "ls").to("sp", "Product");

		builder.where("fp.productID", fromProductID);
		builder.where("sp.productID", toProductID);
		builder.whereRaw("fp.productID <> sp.productID");

		builder.return(
			"c.customerID AS customerID",
			"c.companyName AS company",
			"c.country AS country",
			"firstOrder.orderID AS firstOrderID",
			"toString(firstOrder.orderDate) AS firstDate",
			"secondOrder.orderID AS secondOrderID",
			"toString(secondOrder.orderDate) AS secondDate",
		);
		builder.orderBy("c.companyName", "ASC");

		const output = await neode.read(builder);

		return context.json({
			fromProductID,
			toProductID,
			journeys: output.records.map((row) => ({
				customerID: String(row.get("customerID")),
				company: String(row.get("company")),
				country: String(row.get("country")),
				firstOrderID: Number(row.get("firstOrderID")),
				firstDate: String(row.get("firstDate")),
				secondOrderID: Number(row.get("secondOrderID")),
				secondDate: String(row.get("secondDate")),
			})),
		});
	});

	return routes;
}
