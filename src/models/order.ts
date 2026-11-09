import {
	Computed,
	CreatedAt,
	DateTime,
	Direction,
	NodeEntity,
	OneToMany,
	Primary,
	Property,
	RelatedMany,
	RelatedOne,
} from "neode";
import { Customer } from "./customer.js";
import { Employee } from "./employee.js";
import { OrderLine } from "./order-line.js";
import { Product } from "./product.js";
import { Shipper } from "./shipper.js";

@NodeEntity()
class Order {
	@Primary()
	@Property({ type: "number", description: "Northwind order id" })
	orderID!: number;

	@DateTime({ description: "When the order was placed" })
	orderDate!: string;

	@DateTime()
	requiredDate!: string;

	@DateTime()
	shippedDate!: string | undefined;

	@Property({ type: "float", min: 0 })
	freight!: number;

	@Property({ type: "string" })
	shipName!: string;

	@Property({ type: "string" })
	shipStreet!: string;

	@Property({ type: "string" })
	shipCity!: string;

	@Property({ type: "string", coalesce: "" })
	shipRegion!: string;

	@Property({ type: "string" })
	shipPostalCode!: string;

	@Property({ type: "string", index: true })
	shipCountry!: string;

	/** The demo's Duration property: shippedDate − orderDate, computed by the seed. */
	@Property({
		type: "duration",
		description: "Time from placement to shipment",
	})
	timeToShip!: unknown;

	/**
	NTS-138 — derived at read, never stored: whole days from placement to
	shipment (undefined until the order ships). String() coerces hydrated
	temporal objects to ISO before Date.parse.
	*/
	@Computed((entity) => {
		const order = entity as Order;

		return order.shippedDate == null
			? undefined
			: Math.max(
					0,
					Math.floor(
						(Date.parse(String(order.shippedDate)) -
							Date.parse(String(order.orderDate))) /
							86_400_000,
					),
				);
	})
	daysToShip?: number;

	/** When the record entered our graph — not a business date. */
	@CreatedAt()
	@Property({ type: "datetime" })
	createdAt!: string;

	// ---- Projection read-model ----

	/** NTS-135 — customer DTO inline on every order row. */
	@RelatedOne({
		type: "PLACED_BY",
		direction: Direction.OUTGOING,
		target: () => Customer,
		fields: ["customerID", "companyName", "country"],
	})
	customer?: Pick<Customer, "customerID" | "companyName" | "country">;

	// ---- Graph shape ----

	@OneToMany(() => Customer, "PLACED_BY", Direction.OUTGOING)
	placedBy?: Customer[];

	@OneToMany(() => Employee, "TAKEN_BY", Direction.OUTGOING)
	takenBy?: Employee[];

	@OneToMany(() => Shipper, "SHIPPED_VIA", Direction.OUTGOING)
	shippedVia?: Shipper[];

	/**
	The first-class edge: CONTAINS carries unitPrice/quantity/discount as
	an OrderLine. Kept `unknown` on purpose: a relationship-entity target
	loads at the spec ROOT only — typing the field would advertise nested
	relationship keys the runtime rejects.
	*/
	@OneToMany(() => OrderLine, "CONTAINS", Direction.OUTGOING)
	lines?: unknown;

	/**
	NTS-499 — the same CONTAINS edge, node-targeted: the related() +
	edge-return read the order-lines view uses (rows of product + edge).
	*/
	@OneToMany(() => Product, "CONTAINS", Direction.OUTGOING)
	products?: Product[];

	/**
	NTS-547 — products co-ordered with THIS order's products (other orders
	containing them), not already in the order itself: the two-hop co-purchase
	read, projected inline with the order.
	*/
	@RelatedMany({
		path: [
			{ type: "CONTAINS", direction: Direction.OUTGOING },
			{ type: "CONTAINS", direction: Direction.INCOMING },
			{ type: "CONTAINS", direction: Direction.OUTGOING },
		],
		target: () => Product,
		fields: ["productID", "name", "unitPrice"],
		where: "NOT (this)-[:CONTAINS]->(node)",
	})
	coPurchased?: Pick<Product, "productID" | "name" | "unitPrice">[];

	// NTS-563 — the type-level model map: the keys `with` load specs
	// accept. coPurchased is a projection read-model, not a loadable key.
	declare static readonly neodeRelationships: {
		placedBy: true;
		takenBy: true;
		shippedVia: true;
		lines: true;
		products: true;
	};
}

export { Order };
