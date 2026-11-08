import { CreatedAt, NodeEntity, Point, Primary, Property } from "neode";

@NodeEntity()
class Supplier {
	@Primary()
	@Property({ type: "number", description: "Northwind supplier id" })
	supplierID!: number;

	@Property({
		type: "string",
		fulltext: true,
		description: "Supplier company name",
	})
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

	/** Supplier HQ — the withinDistance() demo. Coordinates from the seed's city atlas. */
	@Point({ description: "Supplier HQ coordinates (SRID 4326)" })
	location!: unknown;

	@CreatedAt()
	@Property({ type: "datetime" })
	createdAt!: string;
}

export { Supplier };
