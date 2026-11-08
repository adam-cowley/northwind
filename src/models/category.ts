import { NodeEntity, Property, Primary } from "neode";

@NodeEntity()
class Category {
	@Primary()
	@Property({ type: "number", description: "Northwind category id" })
	categoryID!: number;

	@Property({ type: "string", fulltext: true, description: "Category name" })
	name!: string;

	@Property({ type: "string", description: "What the category covers" })
	description!: string;
}

export { Category };
