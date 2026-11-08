import { Builder, EntityRepository, NeodeError, Repository } from "neode";
import { Order } from "../models/order.js";
import { durationBetween } from "./order-types.js";

/**
The order desk's read + simple-write surface. INeode-scope only (tx-safe:
works through custom repositories inside an open transaction). The
transactional orchestration lives in NorthwindService (services/).
*/
@EntityRepository(Order)
class OrderRepository extends Repository<Order> {
	/**
  Ship an order: stamp the shipped date + the timeToShip Duration. Dirty
  tracking writes only the two changed fields.
  */
	async ship(order: Order): Promise<Order> {
		if (order.shippedDate !== undefined && order.shippedDate !== null) {
			throw new NeodeError(`Order ${order.orderID} is already shipped`);
		}

		const shippedDate = new Date().toISOString();
		order.shippedDate = shippedDate;
		order.timeToShip = durationBetween(order.orderDate, shippedDate);

		return this.save(order);
	}

	/** Cancel an order — DETACH DELETE drops the order and its CONTAINS lines. */
	async cancel(orderID: number): Promise<void> {
		await this.delete(orderID);
	}

	/**
  One customer's order history, newest first — the Builder seam: a raw
  relationship traversal the property-filter methods cannot express, read
  and hydrated to entities in one call through the scope's hydrate option
  (NTS-559).
  */
	async historyForCustomer(customerID: string, limit = 20): Promise<Order[]> {
		const builder = new Builder();

		builder
			.match("o", "Order")
			.relationship("PLACED_BY", "out", "r")
			.to("c", "Customer")
			.where("c.customerID", customerID)
			.return("o")
			.orderBy("o.orderDate", "DESC")
			.limit(limit);

		return this.neode.read(builder, {
			hydrate: Order,
			alias: "o",
			// exactOptionalPropertyTypes: an explicit undefined would reject the
			// hydrate overload and fall through to the raw one
			...(this.database === undefined ? {} : { database: this.database }),
		});
	}
}

export { OrderRepository };
