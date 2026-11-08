import {
	Date,
	DateTime,
	NodeEntity,
	OneToMany,
	Primary,
	Property,
	RelatedMany,
} from "neode";
import { Direction } from "neode";
import { Territory } from "./map-models/territory.js";

@NodeEntity()
class Employee {
	@Primary()
	@Property({ type: "number", description: "Northwind employee id" })
	employeeID!: number;

	@Property({ type: "string" })
	lastName!: string;

	@Property({ type: "string" })
	firstName!: string;

	@Property({ type: "string" })
	title!: string;

	@Property({ type: "string" })
	titleOfCourtesy!: string;

	@Date()
	birthDate!: string;

	@Date()
	hireDate!: string;

	@Property({ type: "string" })
	street!: string;

	@Property({ type: "string" })
	city!: string;

	@Property({ type: "string" })
	postalCode!: string;

	@Property({ type: "string" })
	country!: string;

	@Property({ type: "string" })
	phone!: string;

	@Property({ type: "string" })
	notes!: string;

	/** Northwind's reportsTo, kept as the raw id when unset ('NULL' in the source data). */
	@Property({ type: "string", coalesce: "" })
	reportsTo!: string;

	@DateTime()
	lastActiveAt!: string;

	// ---- Projection read-model ----

	/** NTS-135 — full-entity RelatedMany (no fields): direct reports load eagerly as entities. */
	@RelatedMany({ type: "REPORTS_TO", direction: "in", target: () => Employee })
	directReports!: Employee[];

	// ---- Graph shape ----

	// employee → their manager (the edge direction; directReports reads it incoming)
	@OneToMany(() => Employee, "REPORTS_TO", Direction.OUTGOING)
	reportsToRel?: unknown;

	@OneToMany(() => Territory, "COVERS", Direction.OUTGOING)
	covers?: unknown;
}

export { Employee };
