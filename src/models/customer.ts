import {
	CreatedAt,
	NodeEntity,
	Primary,
	Property,
	RelationshipCount,
	UpdatedAt,
} from "neode";

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
}

export { Customer };
