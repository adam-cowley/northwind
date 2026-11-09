import { EntityRepository, NeodeError, Repository } from "neode";
import { Order } from "../models/order.js";
import { durationBetween } from "./order-types.js";

/**
The order desk's read + simple-write surface. INeode-scope only (tx-safe:
works through custom repositories inside an open transaction). The
transactional orchestration lives in NorthwindService (services/); the
order-history read lives there too now — the NTS-560 load spec on
Customer.orders (was: the Builder seam here).
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
}

export { OrderRepository };
