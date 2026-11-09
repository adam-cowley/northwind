# 🌬️ Northwind Ops — the flagship demo for `neode`

It is 1998 and you have just been hired as Head of Ops at Northwind Traders.
The company's entire business — 77 products, 29 suppliers, 91 customers, 830
orders and every order line — lives in a graph. You get one console:
**Dashboard · Catalog · Order desk · Suppliers · Console · Ops**.

Every feature of the `neode` OGM earns its keep somewhere in those six
screens, the wishlist features included. This is the reference app for
"what a full-fat neode consumer looks like".

```sh
pnpm install            # workspace root
pnpm --filter northwind build
pnpm --filter northwind start     # zero config: embedded engine + auto-seed
# or against a real server:
NEO4J_URI=bolt://localhost:7687 NEO4J_USERNAME=neo4j NEO4J_PASSWORD=x pnpm --filter northwind start

pnpm --filter northwind test      # 63 tests, embedded engine, no setup
pnpm --filter northwind dev       # rebuilds + restarts on change (esbuild watch → node --watch) + vite HMR on :5173
```

## Feature coverage map

| neode feature                                                                                           | Where it stars                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `@NodeEntity` decorator API                                                                             | All of `src/models/`                                                                            |
| Map API (`defineModel`) + `withDirectory`                                                               | `src/models/map-models/` (Territory, Region)                                                    |
| `@RelationshipEntity` + `@StartNode`/`@EndNode`                                                         | `src/models/order-line.ts` — `CONTAINS` edges carry unitPrice/quantity/discount                 |
| `@Primary` business keys / `@Uuid`                                                                      | `customerID`, `productID`, `orderID`… / `OrderLine.id`                                          |
| Property types: `float`, `number`, `boolean`, `datetime`, `date`, `duration`, `point`, arrays           | Order dates, `timeToShip`, supplier `location`, `Product.embedding`                             |
| `@Version` optimistic locking (NTS-158)                                                                 | `Product.version` — concurrent stock writes conflict (order-flow test)                          |
| `@CreatedAt`/`@UpdatedAt` (NTS-165)                                                                     | Customer, Supplier, Order                                                                       |
| `@Unique` + composite uniques (NTS-140)                                                                 | `(name, supplierID)` on Product                                                                 |
| `@Index`, `@Primary`                                                                                    | `shipCountry`, `country`, business keys                                                         |
| `@Property` validation rules (Zod)                                                                      | `min`/`max` on prices, stock, quantities — 422s in the API                                      |
| `@Property` `coalesce` (NTS-139)                                                                        | absent `region` hydrates as `''`                                                                |
| `@Property` `fulltext: true` (NTS-436) + `Repository#search` + `toFulltextQuery`                        | Product/Category/Customer name search                                                           |
| `@Vector` (NTS-447) + embedding `provider`/`from` (NTS-449)                                             | `Product.embedding` — 64-dim deterministic embedder (`src/embed.ts`), library computes on write |
| `@RelatedOne`/`@RelatedMany` (NTS-135)                                                                  | catalog rows: supplier DTO, scalar category, employee `directReports`                           |
| `@RelationshipCount` (NTS-136)                                                                          | `Product.orderCount`, `Customer.orderCount`                                                     |
| `@RelationshipExists` (NTS-137)                                                                         | `Product.hasBeenOrdered`                                                                        |
| `@LabelPresent` (NTS-137)                                                                               | `Product.isBestseller` (`:Bestseller` label, stamped by `runCypherScript`)                      |
| `@Expression` (NTS-138)                                                                                 | `Product.belowReorder` — raw Cypher on `this`                                                   |
| `@Computed` (NTS-138)                                                                                   | `Product.inStock` — derived in TypeScript, never stored                                         |
| Dirty tracking + partial SET (NTS-157)                                                                  | catalog edits write only changed fields                                                         |
| `Repository` + `@EntityRepository` custom subclasses                                                    | `src/repositories/`                                                                             |
| `Repository#upsert` (built for this demo)                                                               | `PUT /api/products/:id`                                                                         |
| `Repository#increment` (atomic)                                                                         | restock — one server-side statement                                                             |
| `Repository#search` (declarative fulltext, NTS-436)                                                     | `ProductRepository.searchProducts`                                                              |
| Facade CRUD + `merge`/`mergeOn`                                                                         | customer create (409 via `ConstraintViolationError`), idempotent seed                           |
| `openWriteTransaction` + tx-scoped `INeode`                                                             | `NorthwindService.placeOrder` — all-or-nothing order placement                                  |
| `neode.transaction()` — ambient tx via AsyncLocalStorage (NTS-156)                                      | request middleware: every write request runs in one transaction (calls inside join it; bulk/explain/profile/schema + `/api/ask` routes opt out) |
| `relate()` with edge-entity properties                                                                  | order lines, validated + converted (NTS-509)                                                    |
| `delete()` / DETACH DELETE                                                                              | cancel order                                                                                    |
| `PaginateService` offset mode                                                                           | catalog pages                                                                                   |
| `PaginateService` cursor/keyset mode                                                                    | the live order feed (temporal cursor)                                                           |
| `knn()` (Cypher 25 `SEARCH` → `queryNodes` fallback)                                                    | "similar products", kNN half of search                                                          |
| `withinDistance`                                                                                        | supplier map (WGS 84 points, metres)                                                            |
| `Builder` (fluent Cypher, zero string interpolation)                                                    | analytics: revenue by country, top products, customer history                                   |
| `installSchema` / `inspectSchema` / `schemaDrift` + `formatSchemaDrift`                                 | Ops page — live drift report                                                                    |
| `verifyConnectivity` / `waitUntilReachable`                                                             | boot sequence + seed CLI                                                                        |
| `runCypherScript` / `splitCypherStatements`                                                             | `seed.cypher` — `:Bestseller` labelling step                                                    |
| Events (`NODE_*`, `RELATIONSHIP_*`) + SSE                                                               | the Dashboard's live activity feed                                                              |
| `QUERY_EXECUTED` events                                                                                 | the Ops query inspector (every statement the ORM ran)                                           |
| `instrumentConnectionProvider`                                                                          | the provider-level tap in `server.ts`                                                           |
| `ontology()` / `ontologyMarkdown()` (NTS-445)                                                           | the Console's live schema panel                                                                 |
| `jsonSafe` / `jsonSafeRecord`                                                                           | console + order-line serialisation                                                              |
| Typed error taxonomy (`classifyError`, `ConstraintViolationError`, `TransientError`, `ValidationError`) | API error middleware → 409/503/422/400                                                          |
| `wipe` / `testId`                                                                                       | the test suites                                                                                 |
| `fromEnv` (full `NEO4J_*` parity)                                                                       | server + seed CLI connection                                                                    |
| Embedded `RelateConnectionProvider` (zero-setup)                                                        | default backend here and in tests; real servers via `NEO4J_*`                                   |

## The graph

```
(Customer)-[:PLACED_BY]->... wait, direction: (Order)-[:PLACED_BY]->(Customer)
(Order)-[:TAKEN_BY]->(Employee)
(Order)-[:SHIPPED_VIA]->(Shipper)
(Order)-[:CONTAINS {unitPrice, quantity, discount}]->(Product)   ← the edge entity
(Product)-[:SUPPLIED_BY]->(Supplier)
(Product)-[:PART_OF]->(Category)
(Employee)-[:REPORTS_TO]->(Employee)          ← self-relationship, eager in
(Employee)-[:COVERS]->(Territory)-[:IN_REGION]->(Region)
```

## Data

The classic [Northwind](https://github.com/graphql-compose/graphql-compose-examples/tree/master/examples/northwind)
sample dataset (Microsoft's public sample data), vendored as JSON in
`src/seed/data/` with order details intact — the seed loads it through the
OGM itself: `mergeMany` for reference data, one open transaction for
products (embeddings) + relationships, `runCypherScript` for labels.
Re-runnable; converges (idempotency is tested).

## Second act (NTS-513…527)

The console grew up. What the second act adds on top of the first:

- **Order desk 2.0** — order detail with editable `CONTAINS` lines (edge updates through the Builder), line totals, ship/cancel in place
- **Customer 360** — projected order count, cursor-paged history
- **Inventory alerts** — the `@Expression` `belowReorder` projection driving a reorder list with one-click atomic restock
- **Org chart** — the eager `REPORTS_TO` self-relationship + `COVERS`→Territory→Region, one query
- **Load-test panel** — N factory orders live via chunked UNWIND (`100 orders in ~32ms` measured); the Dashboard's SSE feed lights up
- **Bulk import** — paste products, chunked `mergeMany`, idempotent
- **Bulk price update** — all-or-nothing `batch()` with `@Version` bumps
- **Console EXPLAIN** — plan trees per query; **PROFILE** view in Ops
- **Drift repair** — apply missing schema objects from the Ops page (never drops)
- **NL→Cypher** — optional: set `NW_LLM_URL` + `NW_LLM_KEY` and the Console gains an ontology-grounded question box; without keys it hides
- **Single-statement orders** — placeOrder renders the order + relationships + lines + stock decrements as ONE parameterised Builder statement inside the transaction

### Ten graph insights (NTS-531…540)

The Insight fleet — each feature = one file (service + Hono sub-app at `/api/insight`), one view, one integration test, all Builder-built:

| Insight | The graph move |
| --- | --- |
| Basket twins (531) | Jaccard over distinct-product baskets — "customers who buy like you" |
| Supply exposure (532) | supplier → products → orders → customers at risk (4-hop impact) |
| Category affinity (533) | category-pair co-purchase heatmap (56 ordered pairs) |
| Product links (534) | `shortestPath()` between two products (shared order/supplier/customer), hop chips |
| Growth board (535) | month-over-month revenue risers/fallers per product |
| Data quality (536) | negative patterns: never-ordered, silent customers, naked territories |
| Shipper coverage (537) | per-shipper revenue + per-country dominance |
| Reorder network (538) | low stock → supplier call-list → open orders affected |
| Customer journeys (539) | first-order → next-order product transitions, ranked |
| Region rollup (540) | region → territories → employees → orders → revenue |

Engine quirks surfaced and worked around (filed): `sum()` over multi-property arithmetic returns 0 (NTS-543 — alias via WITH first); OPTIONAL MATCH + IS NULL mis-filters (NTS-541); WITH-import correlation inside `EXISTS {}` broken (NTS-542).

### The ID-link pattern + country drilldown (NTS-544)

Every list shows ids and every id is a link: `#/entity/Order/10856`,
`#/Catalog/4`, `#/Customers/ANTON` — hash routing, one generic entity
view (`/api/entity/:type/:id`: properties + typed 1-hop neighborhood,
neighbor types resolvable server-side) plus deep-links into the rich
views (product → catalog drill-in, customer → 360). Countries insight:
which countries order what, drill to the product mix.

### Auth & charts (NTS-529/530)

The console sits behind a session: `/login` (server-rendered, demo credentials `admin` / `northwind`, override with `NW_AUTH_USER` / `NW_AUTH_PASSWORD` / `NW_AUTH_SECRET`), HMAC-signed cookie, 401s redirect the SPA. The Dashboard grew real charts (recharts): revenue by country + orders & revenue per month (`/api/analytics/orders-over-time`).

## Library bugs found & fixed while building

- NTS-501 — `Repository.findAll/findBy` bypassed the projection system
- NTS-502 — `find()` rejected number ids on some scopes
- NTS-503 — `requireRelateClient` unexported (consumers can't open in-memory engines)
- NTS-505 — (relate) empty-string params rejected by the embedded engine
- NTS-506 — bulk writes skipped property-value conversion; driver values unbound at the FFI boundary
- NTS-507 — vector writes required a server-only procedure
- NTS-508 — validation rejected the temporal shapes hydration produces on the embedded engine
- NTS-509 — edge-entity property rules not validated on relate
- NTS-510 — (feature) `@SoftDelete` + global read filters
- NTS-511 — (feature) model observers
- NTS-512 — (feature) typed traversals
- NTS-528 — bulk mergeMany rendered an invalid `ON MATCH` version bump (missing assignment target)
- NTS-505 — (relate, OPEN) the embedded engine rejects empty-string params — worked around by writing absent properties, which is better graph modeling anyway

## Skipped on purpose

Enterprise-only surfaces (`isEnterprise`, existence constraints),
multi-database routing, and a Text2Cypher endpoint (the ontology panel
shows the grounding payload instead — no LLM keys required).
