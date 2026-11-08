import { NodeEntity, Primary, Property } from "neode";

@NodeEntity()
class Shipper {
	@Primary()
	@Property({ type: "number", description: "Northwind shipper id" })
	shipperID!: number;

	@Property({ type: "string", fulltext: true })
	companyName!: string;

	@Property({ type: "string" })
	phone!: string;
}

export { Shipper };
