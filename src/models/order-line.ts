import { EndNode, Property, RelationshipEntity, StartNode, Uuid } from "neode";
import { Order } from "./order.js";
import { Product } from "./product.js";

/**
The relationship AS an entity: CONTAINS carries its own state
(unit price at purchase time, quantity, discount). The demo of
first-class edge models — placed orders write these through
relate(), with the properties converted through THIS schema.
*/
@RelationshipEntity()
class OrderLine {
	@Uuid({ primary: true })
	id!: string;

	@Property({
		type: "float",
		min: 0,
		description: "Unit price at purchase time",
	})
	unitPrice!: number;

	@Property({ type: "number", min: 1, max: 1000 })
	quantity!: number;

	@Property({ type: "float", min: 0, max: 1 })
	discount!: number;

	@StartNode(() => Order)
	order!: Order;

	@EndNode(() => Product)
	product!: Product;
}

export { OrderLine };
