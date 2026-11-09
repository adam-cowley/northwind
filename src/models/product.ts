import { embed } from "../embed.js";
import {
	Computed,
	Direction,
	LabelPresent,
	NodeEntity,
	OneToMany,
	Primary,
	Property,
	RelatedOne,
	RelationshipCount,
	RelationshipExists,
	Expression,
	Vector,
	Version,
} from "neode";
import { Category } from "./category.js";
import { Supplier } from "./supplier.js";

@NodeEntity()
class Product {
	@Primary()
	@Property({ type: "number", description: "Northwind product id" })
	productID!: number;

	@Property({
		type: "string",
		fulltext: true,
		// NTS-140 composite unique: a supplier never lists two products of the same name
		unique: ["name", "supplierID"],
		description: "Product name",
	})
	name!: string;

	@Property({ type: "string" })
	quantityPerUnit!: string;

	@Property({ type: "float", min: 0, description: "List price" })
	unitPrice!: number;

	@Property({
		type: "number",
		min: 0,
		description: "Units in stock — decremented on order",
	})
	unitsInStock!: number;

	@Property({ type: "number", min: 0 })
	unitsOnOrder!: number;

	@Property({ type: "number", min: 0 })
	reorderLevel!: number;

	@Property({ type: "boolean" })
	discontinued!: boolean;

	/**
  Optimistic locking (NTS-158): catalog edits and stock decrements carry
  the version they were read at — concurrent writers get OptimisticLockError.
  */
	@Version()
	@Property({ type: "number" })
	version!: number;

	/**
  NTS-447 + NTS-449: the vector index over a deterministic demo embedding,
  computed by the library from `name` on every write when not given
  explicitly. Searched by knn(). Hidden from serialisation — 64 floats do
  not belong in catalog payloads.
  */
	@Vector({
		dimensions: 64,
		similarityFunction: "cosine",
		from: "name",
		provider: (text) => Promise.resolve(embed(text)),
	})
	@Property({ type: "float", array: true, hidden: true })
	embedding!: number[];

	// ---- Projection read-model (one query per read on the catalog) ----

	/** NTS-135 — supplier DTO projected inline. */
	@RelatedOne({
		type: "SUPPLIED_BY",
		direction: "out",
		target: () => Supplier,
		fields: ["companyName", "country"],
	})
	supplier?: Pick<Supplier, "companyName" | "country">;

	/** NTS-135 — category name projected inline (single field → scalar). */
	@RelatedOne({
		type: "PART_OF",
		direction: "out",
		target: () => Category,
		fields: ["name"],
	})
	category!: string | undefined;

	/** NTS-136 — how many order lines reference this product. */
	@RelationshipCount({ type: "CONTAINS", direction: "in" })
	orderCount!: number;

	/** NTS-137 — boolean existence, cheaper than the count when only presence matters. */
	@RelationshipExists({ type: "CONTAINS", direction: "in" })
	hasBeenOrdered!: boolean;

	/** NTS-137 — label predicate: true when the seed's runCypherScript step labelled it. */
	@LabelPresent("Bestseller")
	isBestseller!: boolean;

	/** NTS-138 — raw Cypher escape hatch: how far below the reorder level we are (root node is `this`). */
	@Expression("coalesce(this.reorderLevel, 0) - coalesce(this.unitsInStock, 0)")
	belowReorder!: number;

	/** NTS-138 — derived in TypeScript after hydration, never stored. */
	@Computed((entity: unknown) => (entity as Product).unitsInStock > 0)
	inStock!: boolean;

	// ---- Graph shape ----

	@OneToMany(() => Supplier, "SUPPLIED_BY", Direction.OUTGOING)
	suppliedBy?: Supplier[];

	@OneToMany(() => Category, "PART_OF", Direction.OUTGOING)
	partOf?: Category[];

	// NTS-563 — the type-level model map: the keys `with` load specs
	// accept (the projection read-model fields above are not loadable keys)
	declare static readonly neodeRelationships: {
		suppliedBy: true;
		partOf: true;
	};
}

export { Product };
