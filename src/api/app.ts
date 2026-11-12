import { EventEmitter } from "node:events";
import { AsyncLocalStorage } from "node:async_hooks";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
	Builder,
	EventType,
	type QueryExecutedEvent,
	type RelationshipEdgeRead,
	formatSchemaDrift,
	getModel,
	inspectSchemaAndDrift,
	jsonSafeRecord,
	ontologyMarkdown,
	toJson,
	validate,
	type WithMethods,
} from "neode";
import type Neode from "neode";
import { currentUser, login, logout, loginPage } from "../auth.js";
import { OrderLine } from "../models/order-line.js";
import { features } from "../features/index.js";
import { mapApiError } from "./errors.js";
import { intQuery } from "./queries.js";

import { Customer } from "../models/customer.js";
import type { Order } from "../models/order.js";
import type { Product } from "../models/product.js";
import type { NorthwindService } from "../services/northwind-service.js";

export interface QueryInspectorEntry {
	cypher: string;
	duration: number;
	at: string;
}

const RING_SIZE = 50;

/**
The whole Northwind Ops API. `neode` is the live instance — the query
inspector taps QUERY_EXECUTED, the activity feed taps the lifecycle
events and pushes them to SSE subscribers.
*/
export function createApp(neode: Neode, service: NorthwindService): Hono {
	const app = new Hono();

	const inspector: QueryInspectorEntry[] = [];
	const activity: { event: string; at: string; summary: string }[] = [];
	const activityBus = new EventEmitter();

	// NTS-523 — request-scoped query timeline: the QUERY_EXECUTED handler
	// appends to whatever request's ALS store is on the stack
	const requestStorage = new AsyncLocalStorage<{
		requestId: string;
		queries: QueryInspectorEntry[];
	}>();

	function record(event: EventType) {
		return (value: unknown): void => {
			const summary =
				typeof value === "object" && value !== null ? describe(value) : "";

			const entry = { event, at: new Date().toISOString(), summary };

			activity.push(entry);
			if (activity.length > RING_SIZE) activity.shift();

			activityBus.emit("activity", entry);
		};
	}

	function describe(value: object): string {
		const record = value as Record<string, unknown>;

		if (typeof record["orderID"] === "number")
			return `order #${record["orderID"]}`;
		if (typeof record["productID"] === "number")
			return `product #${record["productID"]}`;
		if (typeof record["customerID"] === "string")
			return `customer ${record["customerID"]}`;
		if (typeof record["type"] === "string") return String(record["type"]);

		return "";
	}

	neode.on(EventType.NODE_CREATED, record(EventType.NODE_CREATED));
	neode.on(EventType.NODE_UPDATED, record(EventType.NODE_UPDATED));
	neode.on(EventType.NODE_DELETED, record(EventType.NODE_DELETED));
	neode.on(
		EventType.RELATIONSHIP_CREATED,
		record(EventType.RELATIONSHIP_CREATED),
	);
	neode.on(
		EventType.RELATIONSHIP_MERGED,
		record(EventType.RELATIONSHIP_MERGED),
	);
	neode.on(
		EventType.RELATIONSHIP_DELETED,
		record(EventType.RELATIONSHIP_DELETED),
	);

	// The query inspector — every statement the ORM runs, ring-buffered
	neode.on(EventType.QUERY_EXECUTED, (payload) => {
		// The QUERY_EXECUTED payload is the QueryExecutedEvent
		const event = payload as QueryExecutedEvent;

		const entry: QueryInspectorEntry = {
			cypher: event.cypher,
			duration: event.duration,
			at: new Date().toISOString(),
		};

		inspector.push(entry);
		if (inspector.length > RING_SIZE) inspector.shift();

		requestStorage.getStore()?.queries.push(entry);
	});

	// ---- Auth: the whole surface behind the session cookie ----
	app.use("*", async (context, next) => {
		const path = context.req.path;

		if (path === "/login" || path === "/api/health") {
			return next();
		}

		const user = currentUser(context);

		if (user === undefined) {
			return path.startsWith("/api/")
				? context.json({ error: "unauthorized" }, 401)
				: context.redirect("/login");
		}

		context.set("user" as never, user);

		return next();
	});

	// NTS-523 — every request gets an id + an ALS scope for the timeline;
	// x-request-id + x-request-queries tell the UI the request cost
	app.use("/api/*", async (context, next) => {
		const requestId = crypto.randomUUID();
		const store = { requestId, queries: [] as QueryInspectorEntry[] };

		await new Promise<void>((resolve) => {
			void requestStorage.run(store, async () => {
				await next();
				resolve();
			});
		});

		context.header("x-request-id", requestId);
		context.header("x-request-query-count", String(store.queries.length));
	});

	// ---- Request-scoped transactions (NTS-156 ambient tx) ----
	// Every write request runs in one ambient transaction: all
	// facade/repository calls inside join it (no handle threading), it
	// commits with the response and rolls back on a throw. `retries: 0`
	// below — a transient retry re-runs next(), and the request body
	// stream cannot be re-read.
	//
	// NO_REQUEST_TX — handlers on paths that manage their own
	// transactions/sessions (bulk, explain/profile, schema management —
	// see the join list on Neode#transaction) would SELF-DEADLOCK on the
	// embedded Relate engine's single-transaction connection while the
	// request tx holds it; /api/ask must not hold a tx open across the
	// LLM fetch. Add a route here when its handler calls one of those.
	// Even for joining handlers this serialises concurrent writes on the
	// embedded engine — scope it per route group if that bites.
	const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
	const NO_REQUEST_TX = new Set([
		"/api/ask",
		"/api/profile",
		"/api/products/import",
		"/api/schema/repair",
		"/api/load-test",
	]);

	app.use("/api/*", async (context, next) => {
		if (
			!WRITE_METHODS.has(context.req.method) ||
			NO_REQUEST_TX.has(context.req.path)
		) {
			return next();
		}

		return neode.transaction(
			async () => {
				const response = await next();

				// Hono maps handler errors BELOW this middleware (compose catches
				// per dispatch level and sets context.error), so a failed write
				// resolves next() instead of rejecting it — the managed unit's
				// success path would then throw its rollback-only NeodeError over
				// the handler's mapped response. Rethrow: the unit takes the catch
				// path (rollback + rethrow original) and the original error
				// surfaces through the normal error mapping.
				if (context.error !== undefined) {
					throw context.error;
				}

				return response;
			},
			{
				routing: "WRITE",
				retries: 0,
			},
		);
	});

	// ---- Error mapping: the typed error taxonomy → HTTP ----
	app.onError(mapApiError);

	// ---- Auth routes (public) ----
	app.get("/login", (context) => {
		return context.html(loginPage());
	});

	app.post("/login", async (context) => {
		const body = await context.req.parseBody();
		const user = String(body["user"] ?? "");
		const password = String(body["password"] ?? "");

		if (!login(context, user, password)) {
			return context.html(loginPage("Wrong credentials — try again"), 401);
		}

		return context.redirect("/");
	});

	app.post("/logout", (context) => {
		logout(context);

		return context.redirect("/login");
	});

	// ---- Catalog ----
	app.get("/api/catalog", async (context) => {
		// page 0 would compute a negative SKIP — the page floor is 1
		const page = Math.max(1, intQuery(context, "page", 1));
		const limit = intQuery(context, "limit", 12);

		const filter: Record<string, unknown> = {};
		if (context.req.query("discontinued") === "true")
			filter["discontinued"] = true;
		if (context.req.query("discontinued") === "false")
			filter["discontinued"] = false;

		const result = await service.catalog(page, limit, filter);

		return context.json({
			...result,
			items: result.items.map((item) => toJson(item)),
		});
	});

	app.get("/api/products/:id", async (context) => {
		const detail = await service.product(Number(context.req.param("id")));

		if (detail === undefined) {
			return context.json({ error: "not_found" }, 404);
		}

		return context.json({
			product: toJson(detail.product),
			// Same nested shape as /api/search — the UI reads hit.product.*
			similar: detail.similar.map((hit) => ({
				score: hit.score,
				product: toJson(hit.entity),
			})),
		});
	});

	/**
  Upsert demo: PUT with the unique key + fields — create or update in one
  statement. Existing? The dirty-tracking save path writes only the
  changed fields.
  */
	app.put("/api/products/:id", async (context) => {
		const body = await context.req.json<Record<string, unknown>>();
		const productID = Number(context.req.param("id"));

		const existing = await service.products.find(productID);

		if (existing !== undefined) {
			Object.assign(existing, body);

			return context.json(toJson(await service.products.save(existing)));
		}

		const upserted = await service.products.upsert({ ...body, productID });

		if (upserted === undefined) {
			return context.json({ error: "upsert_failed" }, 400);
		}

		return context.json(toJson(upserted), 201);
	});

	app.post("/api/products/:id/discontinue", async (context) => {
		// One tx: find + flag flip (joins the request tx opened above)
		const product = await service.products.update(
			Number(context.req.param("id")),
			{ discontinued: true },
		);

		if (product === undefined) {
			return context.json({ error: "not_found" }, 404);
		}

		return context.json(toJson(product));
	});

	app.post("/api/products/:id/restock", async (context) => {
		const body = await context.req.json<{ by?: number }>();
		const product = await service.products.find(
			Number(context.req.param("id")),
		);

		if (product === undefined) {
			return context.json({ error: "not_found" }, 404);
		}

		const unitsInStock = await service.restock(product, body.by ?? 50);

		return context.json({ productID: product.productID, unitsInStock });
	});

	// ---- Search: full-text + kNN side by side ----
	app.get("/api/search", async (context) => {
		const query = context.req.query("q");

		if (query === undefined || query.trim() === "") {
			return context.json({ text: [], similar: [] });
		}

		return context.json(await service.search(query, 8));
	});

	// ---- Orders ----
	app.get("/api/orders", async (context) => {
		const feed = await service.feed(
			context.req.query("after"),
			intQuery(context, "limit", 20),
		);

		return context.json({
			...feed,
			items: feed.items.map((item) => toJson(item)),
		});
	});

	app.get("/api/orders/:id", async (context) => {
		const order = await service.orders.find(Number(context.req.param("id")));

		if (order === undefined) {
			return context.json({ error: "not_found" }, 404);
		}

		// NTS-499 — the edge-returning related() read: each row carries the
		// hydrated product alongside the traversed CONTAINS edge, no raw
		// builder or result-row casts
		const rows = (await (order as WithMethods<Order>)
			.related("products")
			.withRelationship()
			.find()) as unknown as RelationshipEdgeRead<Product>[];

		return context.json({
			order: toJson(order),
			lines: rows.map(({ node, edge }) => {
				// Flat shapes: the view should not know the wire format
				return {
					elementId: edge.elementId,
					productID: Number(node.productID),
					name: String(node.name ?? ""),
					unitPrice: Number(node.unitPrice ?? 0),
					quantity: Number(edge.properties["quantity"] ?? 0),
					discount: Number(edge.properties["discount"] ?? 0),
				};
			}),
		});
	});

	app.post("/api/orders", async (context) => {
		const body = await context.req.json<{
			customerID: string;
			employeeID: number;
			shipperID: number;
			items: { productID: number; quantity: number; discount?: number }[];
		}>();

		const placed = await service.placeOrder(body);

		return context.json(toJson(placed), 201);
	});

	app.get("/api/orders/:id/upsell", async (context) => {
		return context.json({
			opportunities: await service.upsellForOrder(
				Number(context.req.param("id")),
			),
		});
	});

	app.post("/api/orders/:id/lines", async (context) => {
		const body = await context.req.json<{
			productID: number;
			quantity?: number;
			discount?: number;
		}>();

		await service.addLine(Number(context.req.param("id")), body);

		return context.json({ added: true });
	});

	app.post("/api/orders/:id/ship", async (context) => {
		const order = await service.orders.find(Number(context.req.param("id")));

		if (order === undefined) {
			return context.json({ error: "not_found" }, 404);
		}

		return context.json(toJson(await service.ship(order)));
	});

	app.delete("/api/orders/:id", async (context) => {
		await service.cancel(Number(context.req.param("id")));

		return context.json({ cancelled: true });
	});

	// ---- Customers ----
	app.get("/api/customers/:id", async (context) => {
		return context.json(await service.customerProfile(context.req.param("id")));
	});

	app.post("/api/customers", async (context) => {
		const body = await context.req.json<Record<string, unknown>>();

		// Duplicate primary keys surface as ConstraintViolationError → 409
		const created = await neode.create(Customer, body);

		return context.json(toJson(created), 201);
	});

	// ---- Suppliers near (withinDistance) ----
	app.get("/api/suppliers/near", async (context) => {
		const latitude = Number(context.req.query("lat"));
		const longitude = Number(context.req.query("lon"));
		const radius = Number(context.req.query("radius") ?? 500);

		if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
			return context.json({ error: "lat and lon are required numbers" }, 400);
		}

		const suppliers = await service.suppliersNear(
			{ latitude, longitude },
			radius,
		);

		return context.json({ suppliers: suppliers.map((item) => toJson(item)) });
	});

	// ---- Analytics (pure Builder) ----
	app.get("/api/analytics/revenue-by-country", async (context) => {
		return context.json(
			await service.revenueByCountry(intQuery(context, "limit", 10)),
		);
	});

	app.get("/api/analytics/top-products", async (context) => {
		return context.json(
			await service.topProducts(intQuery(context, "limit", 10)),
		);
	});

	app.get("/api/analytics/orders-over-time", async (context) => {
		return context.json(await service.ordersOverTime());
	});

	app.get("/api/org", async (context) => {
		return context.json(await service.org());
	});

	app.get("/api/products/:id/sales-over-time", async (context) => {
		return context.json(
			await service.productSalesOverTime(Number(context.req.param("id"))),
		);
	});

	app.get("/api/products/:id/companies", async (context) => {
		return context.json(
			await service.topCompaniesForProduct(Number(context.req.param("id"))),
		);
	});

	app.get("/api/products/:id/also-bought", async (context) => {
		return context.json(
			await service.alsoBought(Number(context.req.param("id"))),
		);
	});

	// ---- Console (read-only Cypher) + ontology ----
	app.post("/api/console", async (context) => {
		const body = await context.req.json<{ cypher: string }>();

		// readCypher only: a read transaction refuses writes server-side
		const output = await neode.readCypher(body.cypher, {});

		return context.json({
			columns: output.records[0]?.keys ?? [],
			rows: output.records.map((row) => {
				const safe = jsonSafeRecord(row);

				return (safe.keys ?? []).map((key) => safe.get(key));
			}),
			summary: output.summary,
		});
	});

	app.get("/api/ontology", (context) => context.text(ontologyMarkdown()));

	// ---- Ops: schema, drift, inspector, health ----
	app.get("/api/schema", async (context) => {
		// One probe serves both payloads — schemaDrift() inspects internally
		const { inspection, drift } = await inspectSchemaAndDrift(
			neode.getConnection(),
		);

		return context.json({ inspection, drift: formatSchemaDrift(drift) });
	});

	app.get("/api/inspector", (context) => {
		return context.json({ statements: inspector });
	});

	app.get("/api/events", (context) => {
		return streamSSE(context, async (stream) => {
			for (const entry of activity) {
				await stream.writeSSE({ data: JSON.stringify(entry) });
			}

			const listener = (entry: unknown): void => {
				void stream.writeSSE({ data: JSON.stringify(entry) });
			};

			activityBus.on("activity", listener);

			// Close the stream when the client disconnects
			context.req.raw.signal.addEventListener("abort", () => {
				activityBus.off("activity", listener);
			});

			await new Promise<void>((resolve) => {
				context.req.raw.signal.addEventListener("abort", () => resolve());
			});
		});
	});

	// ---- Order desk 2.0 (NTS-513): edge updates via Builder ----
	app.patch("/api/order-lines/:elementId", async (context) => {
		const body = await context.req.json<{
			quantity?: number;
			discount?: number;
		}>();

		// Validate against the OrderLine schema before touching the edge
		const patch: Record<string, unknown> = {};
		if (body.quantity !== undefined) patch["quantity"] = body.quantity;
		if (body.discount !== undefined) patch["discount"] = body.discount;

		validate(patch, getModel(OrderLine));

		const builder = new Builder();

		builder.match().relationship(undefined, undefined, "rel").toAnything();
		builder.where("elementId(rel)", context.req.param("elementId"));
		builder.set("rel", patch, "+=");
		builder.return("properties(rel) AS line");

		const output = await neode.write(builder);

		const safe = jsonSafeRecord(output.records[0]!);

		return context.json({ line: safe.get("line") });
	});

	// ---- Bulk price update (NTS-519) ----
	app.post("/api/products/price-update", async (context) => {
		const body = await context.req.json<{
			updates: { productID: number; factor: number }[];
		}>();

		return context.json(await service.updatePrices(body.updates));
	});

	// ---- Bulk import (NTS-520) ----
	app.post("/api/products/import", async (context) => {
		const body = await context.req.json<{ rows: Record<string, unknown>[] }>();

		return context.json(await service.importProducts(body.rows));
	});

	// ---- EXPLAIN / PROFILE (NTS-521) ----
	app.get("/api/explain", async (context) => {
		const query = context.req.query("q");

		if (query === undefined || query.trim() === "") {
			return context.json({ error: "q is required" }, 400);
		}

		return context.json(await service.explainQuery(query));
	});

	app.post("/api/profile", async (context) => {
		const body = await context.req.json<{ cypher: string }>();

		return context.json(await service.profileQuery(body.cypher));
	});

	// ---- Drift repair (NTS-522) ----
	app.post("/api/schema/repair", async (context) => {
		const body = await context.req
			.json<{ dropStale?: boolean }>()
			.catch(() => ({ dropStale: false }));

		return context.json(await service.repairDrift(body.dropStale === true));
	});

	// ---- Load-test panel (NTS-518) ----
	app.post("/api/load-test", async (context) => {
		const body = await context.req.json<{ count?: number }>();

		return context.json(
			await service.loadTestOrders(Math.min(body.count ?? 100, 10000)),
		);
	});

	// ---- Graph explorer (NTS-517) ----
	app.get("/api/explore", async (context) => {
		const type = context.req.query("type");
		const pk = context.req.query("pk");
		const id = context.req.query("id");

		if (type === undefined || pk === undefined || id === undefined) {
			return context.json({ error: "type, pk and id are required" }, 400);
		}

		return context.json(await service.explore(type, pk, id));
	});

	// ---- NL→Cypher (NTS-524, optional key) ----
	app.post("/api/ask", async (context) => {
		const url = process.env["NW_LLM_URL"];
		const key = process.env["NW_LLM_KEY"];

		if (url === undefined || key === undefined) {
			return context.json(
				{ error: "not_configured", hint: "set NW_LLM_URL + NW_LLM_KEY" },
				501,
			);
		}

		const body = await context.req.json<{ question: string }>();

		// Ground the prompt with the live ontology, read-only enforced below
		const answer = await fetch(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${key}`,
			},
			body: JSON.stringify({
				messages: [
					{
						role: "system",
						content: [
							"You write Cypher against the graph described below.",
							"Only use the entities, properties and relationships listed.",
							"Reply with ONE read-only Cypher statement (MATCH/RETURN only), no prose.",
							"",
							await ontologyMarkdown(),
						].join("\n"),
					},
					{ role: "user", content: body.question },
				],
			}),
		});

		const payload = (await answer.json()) as {
			choices?: { message?: { content?: string } }[];
		};
		const cypher = (payload.choices?.[0]?.message?.content ?? "").trim();

		if (cypher === "") {
			return context.json({ error: "llm_returned_nothing" }, 502);
		}

		const output = await neode.readCypher(cypher, {});
		const safe = output.records.map((row) => jsonSafeRecord(row));

		return context.json({
			cypher,
			columns: output.records[0]?.keys ?? [],
			rows: safe.map((record) =>
				(record.keys ?? []).map((key) => record.get(key)),
			),
		});
	});

	// ---- Insight features: every sub-app from the registry ----
	for (const { mount, routes } of features) {
		app.route(mount, routes(neode));
	}

	app.get("/api/health", (context) => {
		return context.json({
			ok: true,
			events: activity.length,
			statements: inspector.length,
			nlCypher:
				process.env["NW_LLM_URL"] !== undefined &&
				process.env["NW_LLM_KEY"] !== undefined,
		});
	});

	return app;
}
