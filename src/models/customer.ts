import {
	CreatedAt,
	Direction,
	NodeEntity,
	OneToMany,
	Primary,
	Property,
	RelationshipCount,
	UpdatedAt,
} from "neode";
import { Order } from "./order.js";

@NodeEntity()
class Customer {
	@Primary()
	@Property({
		type: "string",
		description: "Northwind customer id (5 letters)",
	})
	customerID!: string;

	@Property({ type: "string", fulltext: true, description: "Company name" })
	companyName!: string;

	@Property({ type: "string" })
	contactName!: string;

	@Property({ type: "string" })
	contactTitle!: string;

	@Property({ type: "string" })
	street!: string;

	@Property({ type: "string", fulltext: true })
	city!: string;

	@Property({ type: "string", coalesce: "" })
	region!: string;

	@Property({ type: "string" })
	postalCode!: string;

	@Property({ type: "string", index: true })
	country!: string;

	@Property({ type: "string" })
	phone!: string;

	@CreatedAt()
	@Property({ type: "datetime" })
	createdAt!: string;

	@UpdatedAt()
	@Property({ type: "datetime" })
	updatedAt!: string;

	/** NTS-136 — lifetime order count, one COUNT subquery in the read. */
	@RelationshipCount({ type: "PLACED_BY", direction: "in" })
	orderCount!: number;

	/**
	Showcased with the NTS-560 load spec; declared non-eager on purpose —
	customer list reads must not fetch every order. The lazy `() => Order`
	ref keeps the Customer ↔ Order import cycle safe (order.ts imports this).
	*/
	@OneToMany(() => Order, "PLACED_BY", Direction.INCOMING)
	orders?: Order[];

	// NTS-563 — the type-level model map: the keys `with` load specs
	// accept (the runtime EntitySchema stays the source of truth)
	declare static readonly neodeRelationships: { orders: true };
}

export { Customer };
