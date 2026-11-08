import Neode, {
	Builder,
	Direction,
	getModel,
	applySchemaDrift,
	formatSchemaDrift,
	schemaDrift,
	knn,
	NeodeError,
	type CursorPage,
	type INeode,
	type Page,
	PaginateService,
	toJson,
	vectorIndexName,
} from "neode";
import { Customer } from "../models/customer.js";
import { Employee } from "../models/employee.js";
import { Order } from "../models/order.js";
import { Product } from "../models/product.js";
import { Shipper } from "../models/shipper.js";
import { Supplier } from "../models/supplier.js";
import { RawExpression } from "neode";
import { validate } from "neode";
import { OrderLine } from "../models/order-line.js";
import { seedSyntheticOrders } from "../seed/seed.js";
import { embed } from "../embed.js";
import {
	OutOfStockError,
	type PlaceOrderInput,
} from "../repositories/order-types.js";
import type { OrderRepository } from "../repositories/order-repository.js";
import type { ProductRepository } from "../repositories/product-repository.js";
import type { CustomerRepository } from "../repositories/customer-repository.js";

/**
App services over the concrete facade: the operations that need
facade-level machinery (open transactions, the runner for
PaginateService/knn) while the repositories stay on the INeode scope.
*/
export class NorthwindService {
	readonly products: ProductRepository;
	readonly orders: OrderRepository;
	readonly customers: CustomerRepository;
	private readonly neode: Neode;

	constructor(
		neode: Neode,
		products: ProductRepository,
		orders: OrderRepository,
		customers: CustomerRepository,
	) {
		this.neode = neode;
		this.products = products;
		this.orders = orders;
		this.customers = customers;
	}

	async catalog(
		page: number,
		limit: number,
		filter: Partial<Product> = {},
	): Promise<Page<Product>> {
		return this.products.catalog(page, limit, filter);
	}

	/** Product detail: the projected entity + kNN neighbours. */
	async product(productID: number) {
		const product = await this.products.find(productID);

		if (product === undefined) {
			return undefined;
		}

		return { product, similar: await this.similar(product, 5) };
	}

	async searchProducts(text: string, limit = 10) {
		return this.products.searchProducts(text, limit);
	}

	/** Full-text and kNN over the same query text — the two indexes side by side. */
	async search(text: string, limit = 8) {
		const textHits = await this.products.searchProducts(text, limit);

		const index = vectorIndexName({
			label: "Product",
			property: "embedding",
			dimensions: 64,
		});
		const vectorHits = await knn<Product>(
			this.neode.getRunner(),
			Product,
			index,
			embed(text),
			limit,
		);

		return {
			text: textHits.map((hit) => ({
				score: hit.score,
				product: toJson(hit.entity),
			})),
			similar: vectorHits.map((hit) => ({
				score: hit.score,
				product: toJson(hit.entity),
			})),
		};
	}

	/** kNN over the Product @Vector index — the query vector re-embeds the name. */
	async similar(product: Product, k = 5) {
		const index = vectorIndexName({
			label: "Product",
			property: "embedding",
			dimensions: 64,
		});

		const hits = await knn<Product>(
			this.neode.getRunner(),
			Product,
			index,
			embed(product.name),
			k + 1,
		);

		return hits
			.filter((hit) => hit.entity.productID !== product.productID)
			.slice(0, k);
	}

	async discontinue(product: Product) {
		return this.products.discontinue(product);
	}

	async restock(product: Product, by: number) {
		return this.products.restock(product, by);
	}

	/**
  The flagship write — one open transaction: edge entities carrying
  purchase-time state, stock decrements guarded by @Version, all-or-nothing
  rollback. Everything runs against the tx-scoped INeode.
  */
	async placeOrder(input: PlaceOrderInput): Promise<Order> {
		const tx = await this.neode.openWriteTransaction();

		try {
			const customer = await tx.find(Customer, input.customerID);
			if (customer === undefined) {
				throw new NeodeError(`Customer ${input.customerID} does not exist`);
			}

			const employee = await tx.find(Employee, input.employeeID);
			if (employee === undefined) {
				throw new NeodeError(`Employee ${input.employeeID} does not exist`);
			}

			const shipper = await tx.find(Shipper, input.shipperID);
			if (shipper === undefined) {
				throw new NeodeError(`Shipper ${input.shipperID} does not exist`);
			}

			// Resolve + stock-check + schema-validate every line before writing
			const lineSchema = getModel(OrderLine);
			for (const item of input.items) {
				const product = await tx.find(Product, item.productID);

				if (product === undefined) {
					throw new NeodeError(`Product ${item.productID} does not exist`);
				}

				if (product.unitsInStock < item.quantity) {
					throw new OutOfStockError(
						product.productID,
						item.quantity,
						product.unitsInStock,
					);
				}

				// The edge entity's rules (quantity min/max, discount range) —
				// conversion first, then rules (NTS-509 semantics)
				validate(
					{
						unitPrice: product.unitPrice,
						quantity: item.quantity,
						discount: item.discount ?? 0,
					},
					lineSchema,
				);
			}

			const orderRecord = {
				orderID: await this.nextOrderID(tx),
				orderDate: new Date().toISOString(),
				requiredDate: new Date(Date.now() + 10 * 86400000).toISOString(),
				freight: 0,
				// '' (the coalesced-absent shape) back to absent — empty strings
				// are not legal property params on the embedded engine (NTS-505)
				shipName: customer.companyName,
				shipStreet: emptyToAbsent(customer.street),
				shipCity: customer.city,
				shipRegion: emptyToAbsent(customer.region),
				shipPostalCode: emptyToAbsent(customer.postalCode),
				shipCountry: customer.country,
			};

			// Undefined keys (absent customer fields) stay absent — a raw
			// CREATE pattern binds undefined as a null param and the engine
			// rejects it
			const compacted = Object.fromEntries(
				Object.entries(orderRecord).filter(([, value]) => value !== undefined),
			);

			validate(compacted, getModel(Order));

			// ONE statement (NTS-525): order node + the three static
			// relationships + FOREACH over the lines (edge properties read
			// purchase-time unitPrice from the product; atomic server-side
			// stock decrement + version bump)
			const builder = new Builder();

			builder
				.match("c", "Customer", { customerID: input.customerID })
				.match("e", "Employee", { employeeID: input.employeeID })
				.match("s", "Shipper", { shipperID: input.shipperID })
				.create("o", "Order", {
					...compacted,
					createdAt: new RawExpression("datetime()"),
					version: 0,
				})
				.relationship("PLACED_BY", "out")
				.to("c")
				.create("o")
				.relationship("TAKEN_BY", "out")
				.to("e")
				.create("o")
				.relationship("SHIPPED_VIA", "out")
				.to("s");

			builder.forEach("item", "$lines", (sub) => {
				sub
					.merge("p", "Product", {
						productID: new RawExpression("item.productID"),
					})
					.create("o")
					.relationship("CONTAINS", "out", "line", undefined, {
						unitPrice: new RawExpression("p.unitPrice"),
						quantity: new RawExpression("item.quantity"),
						discount: new RawExpression("item.discount"),
					})
					.to("p")
					.setExpr(
						"p.unitsInStock",
						"coalesce(p.unitsInStock, 0) - item.quantity",
					)
					.setExpr("p.version", "coalesce(p.version, 0) + 1");

				return sub;
			});

			builder.return("o.orderID AS orderID");

			const { query, params } = builder.build();

			await tx.writeCypher(query, { ...params, lines: input.items });

			await tx.commit();

			// Re-read through the projection-aware path for the response DTO
			const placed = await this.orders.find(orderRecord.orderID);

			if (placed === undefined) {
				throw new NeodeError("Order was placed but could not be read back");
			}

			return placed;
		} catch (error) {
			await tx.rollback();
			throw error;
		}
	}

	/**
	Upsell opportunities (NTS-546): products co-ordered with THIS order's
	products but not already in it — the co-purchase graph, ranked.
	NTS-547: expressed with the aggregate traversal API.
	*/
	async upsellForOrder(
		orderID: number,
		k = 5,
	): Promise<
		{ productID: number; name: string; unitPrice: number; times: number }[]
	> {
		const rows = await this.neode
			.traverse(Order)
			.where({ orderID })
			.hop("CONTAINS", Direction.OUTGOING, Product) //  t1: this order's products
			.hop("CONTAINS", Direction.INCOMING, Order) //    t2: other orders…
			.hop("CONTAINS", Direction.OUTGOING, Product) // t3: …and what they contain
			.exclude("t0", "CONTAINS", "t3") // not already in THIS order
			.groupBy("t3")
			.countDistinct("t2", "times")
			.orderBy("times", "DESC")
			.limit(k)
			.runAggregates();

		return rows.map((row) => {
			const reco = row["t3"] as Product;

			return {
				productID: reco.productID,
				name: reco.name,
				unitPrice: reco.unitPrice,
				times: Number(row["times"]),
			};
		});
	}

	/**
	Add a line to an existing order: edge entity validated (NTS-509),
	purchase-time price from the product, stock checked + decremented —
	one open transaction.
	*/
	async addLine(
		orderID: number,
		input: { productID: number; quantity?: number; discount?: number },
	): Promise<void> {
		const quantity = input.quantity ?? 1;

		const tx = await this.neode.openWriteTransaction();

		try {
			const order = await tx.find(Order, orderID);
			if (order === undefined) {
				throw new NeodeError(`Order ${orderID} does not exist`);
			}

			const product = await tx.find(Product, input.productID);
			if (product === undefined) {
				throw new NeodeError(`Product ${input.productID} does not exist`);
			}

			if (product.unitsInStock < quantity) {
				throw new OutOfStockError(
					product.productID,
					quantity,
					product.unitsInStock,
				);
			}

			await tx.relate(Order, order, product, "lines", {
				unitPrice: product.unitPrice,
				quantity,
				discount: input.discount ?? 0,
			});

			await tx.writeCypher(
				"MATCH (p:Product { productID: $id }) SET p.unitsInStock = coalesce(p.unitsInStock, 0) - $qty, p.version = coalesce(p.version, 0) + 1",
				{ id: product.productID, qty: quantity },
			);

			await tx.commit();
		} catch (error) {
			await tx.rollback();
			throw error;
		}
	}

	async ship(order: Order) {
		return this.orders.ship(order);
	}

	async cancel(orderID: number) {
		return this.orders.cancel(orderID);
	}

	/**
  The live order feed — keyset (cursor) pagination on the temporal
  property: stable under inserts, unlike offset paging.
  */
	async feed(after?: string, limit = 20): Promise<CursorPage<Order>> {
		const paginator = new PaginateService(this.neode.getRunner());

		return paginator.paginate(
			Order,
			this.orders.entitySchema(),
			{},
			{
				limit,
				orderBy: "orderDate",
				after,
			},
		) as Promise<CursorPage<Order>>;
	}

	async customerProfile(customerID: string) {
		const customer = await this.customers.profile(customerID);

		const history = await this.orders.historyForCustomer(customerID, 25);

		// Serialise through toJson: hydrated temporal objects (the client's
		// decoded classes) would crash string-handling clients
		return { customer: toJson(customer), history: history.map(toJson) };
	}

	/** Suppliers within `radiusKm` of a point — the withinDistance() demo. */
	async suppliersNear(
		point: { latitude: number; longitude: number },
		radiusKm = 500,
	) {
		return this.neode.withinDistance(
			Supplier,
			"location",
			point,
			radiusKm * 1000,
			{},
			"distance",
			25,
		);
	}

	/**
  Revenue by ship country — pure Builder: one traversal chain
  (customer <-[:PLACED_BY]- order -[:CONTAINS]-> product), SUM over the
  edge properties, ORDER BY on the aggregate.
  */
	async revenueByCountry(limit = 10) {
		const builder = new Builder();

		builder
			.match("o", "Order")
			.relationship("CONTAINS", "out", "line")
			.to("p", "Product")
			.return(
				"o.shipCountry AS country",
				"round(sum(line.quantity * line.unitPrice * (1 - line.discount))) AS revenue",
				"count(DISTINCT o) AS orders",
			)
			.orderBy("revenue", "DESC")
			.limit(limit);

		const output = await this.run(builder);

		return output.records.map((row) => ({
			country:
				row.get("country") === null ? "(unknown)" : String(row.get("country")),
			revenue: Number(row.get("revenue")),
			orders: Number(row.get("orders")),
		}));
	}

	/** Monthly sales for ONE product: revenue + order count per month bucket. */
	async productSalesOverTime(
		productID: number,
	): Promise<{ month: string; orders: number; revenue: number }[]> {
		const builder = new Builder();

		builder
			.match("p", "Product", { productID })
			.relationship("CONTAINS", "in", "line")
			.to("o", "Order")
			.return(
				"substring(toString(o.orderDate), 0, 7) AS month",
				"count(DISTINCT o) AS orders",
				"round(sum(line.quantity * line.unitPrice * (1 - line.discount))) AS revenue",
			)
			.orderBy("month", "ASC");

		const output = await this.run(builder);

		return output.records.map((row) => ({
			month: String(row.get("month")),
			orders: Number(row.get("orders")),
			revenue: Number(row.get("revenue")),
		}));
	}

	/** Top companies that order this product, by revenue through their lines. */
	async topCompaniesForProduct(
		productID: number,
		limit = 8,
	): Promise<
		{ customerID: string; company: string; orders: number; revenue: number }[]
	> {
		const builder = new Builder();

		builder
			.match("p", "Product", { productID })
			.relationship("CONTAINS", "in", "line")
			.to("o", "Order")
			.relationship("PLACED_BY", "out", "pb")
			.to("c", "Customer")
			.return(
				"c.customerID AS customerID",
				"c.companyName AS company",
				"count(DISTINCT o) AS orders",
				"round(sum(line.quantity * line.unitPrice * (1 - line.discount))) AS revenue",
			)
			.orderBy("revenue", "DESC")
			.limit(limit);

		const output = await this.run(builder);

		return output.records.map((row) => ({
			customerID: String(row.get("customerID")),
			company: String(row.get("company")),
			orders: Number(row.get("orders")),
			revenue: Number(row.get("revenue")),
		}));
	}

	/**
	"People who also bought A also bought B" — the co-purchase graph: any
	order containing A also containing B, ranked by how many orders.
	*/
	async alsoBought(
		productID: number,
		k = 6,
	): Promise<{ productID: number; name: string; times: number }[]> {
		const builder = new Builder();

		builder
			.match("p", "Product", { productID })
			.relationship("CONTAINS", "in", "l1")
			.to("o", "Order")
			.relationship("CONTAINS", "out", "l2")
			.to("other", "Product")
			.where("other.productID", "<>", productID)
			.return(
				"other.productID AS productID",
				"other.name AS name",
				"count(DISTINCT o) AS times",
			)
			.orderBy("times", "DESC")
			.limit(k);

		const output = await this.run(builder);

		return output.records.map((row) => ({
			productID: Number(row.get("productID")),
			name: String(row.get("name")),
			times: Number(row.get("times")),
		}));
	}

	/**
  Orders + revenue per month (chart data): grouped on the month bucket,
  one Builder query.
  */
	async ordersOverTime(): Promise<
		{ month: string; orders: number; revenue: number }[]
	> {
		const builder = new Builder();

		builder
			.match("o", "Order")
			.relationship("CONTAINS", "out", "line")
			.to("p", "Product")
			.return(
				"substring(toString(o.orderDate), 0, 7) AS month",
				"count(DISTINCT o) AS orders",
				"round(sum(line.quantity * line.unitPrice * (1 - line.discount))) AS revenue",
			)
			.orderBy("month", "ASC");

		const output = await this.run(builder);

		return output.records.map((row) => ({
			month: String(row.get("month")),
			orders: Number(row.get("orders")),
			revenue: Number(row.get("revenue")),
		}));
	}

	/** Top products by line revenue, with stock on hand — Builder + WITH aggregate. */
	async topProducts(limit = 10) {
		const builder = new Builder();

		builder
			.match("o", "Order")
			.relationship("CONTAINS", "out", "line")
			.to("p", "Product")
			.with(
				"p",
				"sum(line.quantity * line.unitPrice * (1 - line.discount)) AS revenue",
			)
			.return("p.name AS name", "p.unitsInStock AS stock", "revenue")
			.orderBy("revenue", "DESC")
			.limit(limit);

		const output = await this.run(builder);

		return output.records.map((row) => ({
			name: String(row.get("name")),
			stock: Number(row.get("stock")),
			revenue: Number(row.get("revenue")),
		}));
	}

	/**
  Bulk price update (NTS-519): one statement per product in ONE batch()
  — all-or-nothing, per-statement errors on failure.
  */
	async updatePrices(
		updates: { productID: number; factor: number }[],
	): Promise<{ applied: number }> {
		const queries = updates.map((update) => ({
			query:
				"MATCH (p:Product { productID: $id }) " +
				"SET p.unitPrice = round(p.unitPrice * $factor * 100) / 100, p.version = coalesce(p.version, 0) + 1",
			params: { id: update.productID, factor: update.factor },
		}));

		await this.neode.batch(queries);

		return { applied: updates.length };
	}

	/**
  Bulk import (NTS-520): mergeMany upserts through chunked UNWIND —
  value-converted (NTS-506), idempotent on the merge fields.
  */
	async importProducts(
		rows: Record<string, unknown>[],
	): Promise<{ imported: number; chunks: number }> {
		const { BulkService } = await import("neode");

		const chunks = await new BulkService(this.neode.getConnection()).mergeMany(
			Product,
			this.products.entitySchema(),
			rows,
		);

		const imported = chunks.reduce(
			(sum, chunk) => sum + chunk.entities.length,
			0,
		);

		return { imported, chunks: chunks.length };
	}

	/**
  The query plan for a READ statement (NTS-521) — EXPLAIN never executes.
  */
	async explainQuery(query: string): Promise<unknown> {
		return this.neode.explain(query, {});
	}

	/**
  The profiled plan (NTS-521/527) — PROFILE EXECUTES, so only read
  statements are accepted (the same guard the console applies via the
  read transaction).
  */
	async profileQuery(query: string): Promise<unknown> {
		if (!/^(\s*)(MATCH|OPTIONAL|UNWIND|RETURN|WITH|CALL)/i.test(query)) {
			throw new NeodeError("Only read statements can be profiled here");
		}

		return this.neode.profile(query, {});
	}

	/**
  Apply the missing schema objects (NTS-522): never drops unless the
  caller passes dropStale.
  */
	async repairDrift(dropStale = false): Promise<{ report: string }> {
		const connection = this.neode.getConnection();

		const drift = await schemaDrift(connection);

		const result = await applySchemaDrift(connection, drift, { dropStale });

		const after = await schemaDrift(connection);

		return {
			report: `${String(result.length)} statement(s) applied\n${formatSchemaDrift(after)}`,
		};
	}

	/**
  The load-test panel (NTS-518): factory-generated orders, chunked UNWIND,
  timed.
  */
	async loadTestOrders(count: number): Promise<{ count: number; ms: number }> {
		const start = performance.now();

		await seedSyntheticOrders(this.neode, count);

		return { count, ms: Math.round(performance.now() - start) };
	}

	/**
  The graph explorer (NTS-517): the node's 1-hop neighbourhood, any
  relationship type, both directions.
  */
	async explore(
		type: string,
		pk: string,
		id: string,
	): Promise<{
		center: Record<string, unknown>;
		edges: { rel: Record<string, unknown>; node: Record<string, unknown> }[];
	}> {
		// Numeric keys arrive as strings from the query — a string param
		// never matches a number property
		const value = /^\d+$/.test(id) ? Number(id) : id;

		const builder = new Builder();

		builder
			.match("n", type, { [pk]: value })
			.relationship(undefined, "both", "r")
			.to("m")
			.return("n", "r", "m")
			.limit(50);

		const { query, params } = builder.build();
		const output = await this.neode.readCypher(query, params);

		const { jsonSafeRecord } = await import("neode");

		const first = output.records[0]?.get("n");

		const center =
			first !== undefined && typeof first === "object"
				? (jsonSafeRecord(output.records[0]!).get("n") as Record<
						string,
						unknown
					>)
				: {};

		const edges = output.records.map((row) => {
			const safe = jsonSafeRecord(row);

			return {
				rel: safe.get("r") as Record<string, unknown>,
				node: safe.get("m") as Record<string, unknown>,
			};
		});

		return { center, edges };
	}

	/**
	Org chart data (NTS-516): every employee with their manager (the
	REPORTS_TO edge points employee → manager), direct-report names and
	territory count — one query, the tree renders client-side.
	*/
	async org(): Promise<
		{
			employeeID: number;
			name: string;
			title: string;
			managerID: number | null;
			reports: string[];
			territories: number;
		}[]
	> {
		const builder = new Builder();

		builder.match("e", "Employee");
		builder
			.optionalMatch("e")
			.relationship("REPORTS_TO", "out", "r")
			.to("manager", "Employee");
		builder.with("e", "manager");
		builder
			.optionalMatch("e")
			.relationship("REPORTS_TO", "in", "r2")
			.to("report", "Employee");
		builder.with(
			"e",
			"manager",
			'collect(report.firstName + " " + report.lastName) AS reportNames',
		);
		builder
			.optionalMatch("e")
			.relationship("COVERS", "out", "cr")
			.to("t", "Territory");
		builder.return(
			"e.employeeID AS employeeID",
			'e.firstName + " " + e.lastName AS name',
			"e.title AS title",
			"manager.employeeID AS managerID",
			"reportNames AS reports",
			"count(t) AS territories",
		);

		const output = await this.run(builder);

		return output.records.map((row) => {
			const managerRaw = row.get("managerID");
			const reportNames = row.get("reports") as unknown[];

			return {
				employeeID: Number(row.get("employeeID")),
				name: String(row.get("name")),
				title: String(row.get("title")),
				managerID:
					managerRaw === null || managerRaw === undefined
						? null
						: Number(managerRaw),
				reports: reportNames
					.map(String)
					.filter(
						(name) => name !== "null null" && name !== "null" && name !== "",
					),
				territories: Number(row.get("territories")),
			};
		});
	}

	private async run(builder: Builder) {
		const { query, params } = builder.build();

		return this.neode.readCypher(query, params);
	}

	private async nextOrderID(tx: INeode): Promise<number> {
		const output = await tx.readCypher(
			"MATCH (o:Order) RETURN max(o.orderID) AS max",
			{},
		);

		const max = output.records[0]?.get("max");

		return (typeof max === "number" ? max : Number(max ?? 10247)) + 1;
	}
}

function emptyToAbsent(value: string | undefined): string | undefined {
	return value === undefined || value === "" ? undefined : value;
}
