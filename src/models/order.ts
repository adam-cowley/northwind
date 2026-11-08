import {
	CreatedAt,
	DateTime,
	Direction,
	NodeEntity,
	OneToMany,
	Primary,
	Property,
	RelatedOne,
} from "neode";
import { Customer } from "./customer.js";
import { Employee } from "./employee.js";
import { OrderLine } from "./order-line.js";
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

	/** When the record entered our graph — not a business date. */
	@CreatedAt()
	@Property({ type: "datetime" })
	createdAt!: string;

	// ---- Projection read-model ----

	/** NTS-135 — customer DTO inline on every order row. */
	@RelatedOne({
		type: "PLACED_BY",
		direction: "out",
		target: () => Customer,
		fields: ["customerID", "companyName", "country"],
	})
	customer!:
		| { customerID: string; companyName: string; country: string }
		| undefined;

	// ---- Graph shape ----

	@OneToMany(() => Customer, "PLACED_BY", Direction.OUTGOING)
	placedBy?: unknown;

	@OneToMany(() => Employee, "TAKEN_BY", Direction.OUTGOING)
	takenBy?: unknown;

	@OneToMany(() => Shipper, "SHIPPED_VIA", Direction.OUTGOING)
	shippedVia?: unknown;

	/** The first-class edge: CONTAINS carries unitPrice/quantity/discount as an OrderLine. */
	@OneToMany(() => OrderLine, "CONTAINS", Direction.OUTGOING)
	lines?: unknown;
}

export { Order };
