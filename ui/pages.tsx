import { useEffect, useState } from "react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { IdLink } from "./nav.js";
import {
	api,
	type CursorPage,
	type OrderRow,
	type Page,
	type ProductRow,
	type QueryInspectorEntry,
} from "./api";

export function Dashboard() {
	const [revenue, setRevenue] = useState<
		{ country: string; revenue: number; orders: number }[]
	>([]);
	const [top, setTop] = useState<
		{ name: string; stock: number; revenue: number }[]
	>([]);
	const [overTime, setOverTime] = useState<
		{ month: string; orders: number; revenue: number }[]
	>([]);
	const [activity, setActivity] = useState<string[]>([]);

	useEffect(() => {
		void api
			.revenueByCountry()
			.then(setRevenue)
			.catch(() => {});
		void api
			.topProducts()
			.then(setTop)
			.catch(() => {});
		void api
			.ordersOverTime()
			.then(setOverTime)
			.catch(() => {});

		const source = new EventSource("/api/events");

		source.onmessage = (message) => {
			setActivity((previous) => [message.data, ...previous].slice(0, 30));
		};

		source.onerror = () => source.close();

		return () => source.close();
	}, []);

	const totalRevenue = revenue.reduce((sum, row) => sum + row.revenue, 0);
	const totalOrders = revenue.reduce((sum, row) => sum + row.orders, 0);

	return (
		<div>
			<h1>Dashboard</h1>
			<div className="cards">
				<div className="card">
					<div className="kpi">{totalRevenue.toLocaleString()}</div>
					<div className="label">lifetime revenue</div>
				</div>
				<div className="card">
					<div className="kpi">{totalOrders.toLocaleString()}</div>
					<div className="label">orders (with lines)</div>
				</div>
				<div className="card">
					<div className="kpi">{revenue.length}</div>
					<div className="label">ship countries</div>
				</div>
			</div>

			<div className="grid2" style={{ marginTop: 24 }}>
				<div>
					<h2>Revenue by ship country</h2>
					<div className="panel" style={{ height: 280 }}>
						<ResponsiveContainer>
							<BarChart
								data={revenue}
								margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
							>
								<CartesianGrid stroke="#21262d" vertical={false} />
								<XAxis
									dataKey="country"
									tick={{ fill: "#8b949e", fontSize: 10 }}
								/>
								<YAxis tick={{ fill: "#8b949e", fontSize: 10 }} width={60} />
								<Tooltip
									contentStyle={{
										background: "#161b22",
										border: "1px solid #30363d",
										borderRadius: 6,
										fontFamily: "inherit",
									}}
									formatter={(value, name) => [
										Number(value).toLocaleString(),
										String(name),
									]}
								/>
								<Bar dataKey="revenue" fill="#f7b32b" radius={[3, 3, 0, 0]} />
							</BarChart>
						</ResponsiveContainer>
					</div>

					<h2>Orders & revenue over time</h2>
					<div className="panel" style={{ height: 260 }}>
						<ResponsiveContainer>
							<AreaChart
								data={overTime}
								margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
							>
								<CartesianGrid stroke="#21262d" vertical={false} />
								<XAxis
									dataKey="month"
									tick={{ fill: "#8b949e", fontSize: 10 }}
								/>
								<YAxis
									yAxisId="orders"
									tick={{ fill: "#8b949e", fontSize: 10 }}
									width={40}
								/>
								<YAxis yAxisId="revenue" orientation="right" hide />
								<Tooltip
									contentStyle={{
										background: "#161b22",
										border: "1px solid #30363d",
										borderRadius: 6,
										fontFamily: "inherit",
									}}
									formatter={(value, name) => [
										Number(value).toLocaleString(),
										String(name),
									]}
								/>
								<Area
									yAxisId="orders"
									dataKey="orders"
									stroke="#58a6ff"
									fill="#58a6ff22"
									strokeWidth={2}
								/>
								<Area
									yAxisId="revenue"
									dataKey="revenue"
									stroke="#3fb950"
									fill="#3fb95022"
									strokeWidth={2}
								/>
							</AreaChart>
						</ResponsiveContainer>
					</div>
				</div>

				<div>
					<h2>Top products</h2>
					<table>
						<thead>
							<tr>
								<th>product</th>
								<th>revenue</th>
								<th>stock</th>
							</tr>
						</thead>
						<tbody>
							{top.map((row) => (
								<tr key={row.name}>
									<td>{row.name}</td>
									<td>{row.revenue.toLocaleString()}</td>
									<td>{row.stock}</td>
								</tr>
							))}
						</tbody>
					</table>

					<h2>Live activity (SSE)</h2>
					<div className="panel feed">
						{activity.length === 0 && (
							<span className="muted">waiting for events…</span>
						)}
						{activity.map((entry, index) => (
							<div className="entry" key={index}>
								{entry}
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

export function Catalog({ initialProduct }: { initialProduct?: string }) {
	const [page, setPage] = useState<Page<ProductRow>>();
	const [selected, setSelected] = useState<number | undefined>(
		initialProduct === undefined ? undefined : Number(initialProduct),
	);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<{
		text: { score: number }[];
		similar: { score: number }[];
	}>();
	const [error, setError] = useState("");

	const load = (pageNumber = 1): void => {
		void api
			.catalog(pageNumber)
			.then(setPage)
			.catch((problem: Error) => setError(problem.message));
	};

	useEffect(() => {
		load(1);
	}, []);

	if (selected !== undefined) {
		return (
			<ProductDetail
				productID={selected}
				onBack={() => setSelected(undefined)}
			/>
		);
	}

	return (
		<div>
			<h1>Catalog</h1>
			{error && <div className="error">{error}</div>}

			<div className="panel">
				<input
					placeholder="search products…"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>{" "}
				<button
					className="primary"
					onClick={() => {
						void api
							.search(query)
							.then(setResults)
							.catch((problem: Error) => setError(problem.message));
					}}
				>
					search (fulltext + knn)
				</button>
				{results && (
					<button onClick={() => setResults(undefined)}>clear</button>
				)}
			</div>

			{results ? (
				<div className="grid2">
					<div>
						<h2>Full-text hits</h2>
						<table>
							<tbody>
								{results.text.map((hit) => (
									<tr key={nameOf(hit)}>
										<td>{nameOf(hit)}</td>
										<td className="muted">score {hit.score.toFixed(2)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<div>
						<h2>kNN (similar)</h2>
						<table>
							<tbody>
								{results.similar.map((hit) => (
									<tr key={nameOf(hit)}>
										<td>{nameOf(hit)}</td>
										<td className="muted">similarity {hit.score.toFixed(3)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			) : (
				<>
					<table>
						<thead>
							<tr>
								<th>id</th>
								<th>product</th>
								<th>supplier</th>
								<th>category</th>
								<th>price</th>
								<th>stock</th>
								<th>orders</th>
								<th>flags</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{page?.items.map((product) => (
								<tr key={product.productID}>
									<td className="muted">{product.productID}</td>
									<td>
										<a
											onClick={() => {
												setSelected(product.productID);
											}}
										>
											{product.name}
										</a>
									</td>
									<td className="muted">
										{product.supplier?.companyName ?? "—"}
									</td>
									<td className="muted">{product.category?.name ?? "—"}</td>
									<td>{product.unitPrice}</td>
									<td className={product.unitsInStock === 0 ? "error" : ""}>
										{product.unitsInStock}
									</td>
									<td>{product.orderCount}</td>
									<td>
										{product.isBestseller && (
											<span className="badge best">bestseller</span>
										)}{" "}
										{product.discontinued && (
											<span className="badge disc">discontinued</span>
										)}{" "}
										{product.inStock && (
											<span className="badge ok">in stock</span>
										)}
									</td>
									<td>
										<button
											onClick={() =>
												void api
													.restock(product.productID, 50)
													.then(() => load(page.page))
											}
										>
											+50 stock
										</button>
										{!product.discontinued && (
											<button
												className="danger"
												onClick={() =>
													void api
														.discontinue(product.productID)
														.then(() => load(page.page))
												}
											>
												discontinue
											</button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					<button
						disabled={page?.page === 1}
						onClick={() => load((page?.page ?? 1) - 1)}
					>
						← prev
					</button>
					<span className="muted">
						{" "}
						page {page?.page} / {page?.totalPages} ({page?.total} products){" "}
					</span>
					<button
						disabled={page !== undefined && page.page >= page.totalPages}
						onClick={() => load((page?.page ?? 1) + 1)}
					>
						next →
					</button>
				</>
			)}
		</div>
	);
}

function ProductDetail({
	productID,
	onBack,
}: {
	productID: number;
	onBack: () => void;
}) {
	const [detail, setDetail] = useState<{
		product: ProductRow;
		similar: { score: number }[];
	}>();
	const [sales, setSales] = useState<
		{ month: string; orders: number; revenue: number }[]
	>([]);
	const [companies, setCompanies] = useState<
		{ customerID: string; company: string; orders: number; revenue: number }[]
	>([]);
	const [alsoBought, setAlsoBought] = useState<
		{ productID: number; name: string; times: number }[]
	>([]);
	const [error, setError] = useState("");

	useEffect(() => {
		void api
			.product(productID)
			.then(setDetail)
			.catch((problem: Error) => setError(problem.message));
		void api
			.productSalesOverTime(productID)
			.then(setSales)
			.catch(() => {});
		void api
			.topCompanies(productID)
			.then(setCompanies)
			.catch(() => {});
		void api
			.alsoBought(productID)
			.then(setAlsoBought)
			.catch(() => {});
	}, [productID]);

	if (error !== "") {
		return (
			<div>
				<button onClick={onBack}>← back to catalog</button>
				<div className="error">{error}</div>
			</div>
		);
	}

	if (detail === undefined) {
		return (
			<div>
				<button onClick={onBack}>← back to catalog</button>
				<div className="muted">loading…</div>
			</div>
		);
	}

	const product = detail.product;

	return (
		<div>
			<button onClick={onBack}>← back to catalog</button>

			<h1>
				{product.name}{" "}
				{product.isBestseller && <span className="badge best">bestseller</span>}{" "}
				{product.discontinued && (
					<span className="badge disc">discontinued</span>
				)}{" "}
				{product.inStock && <span className="badge ok">in stock</span>}
			</h1>

			<div className="cards">
				<div className="card">
					<div className="kpi">{product.unitPrice}</div>
					<div className="label">unit price</div>
				</div>
				<div className="card">
					<div className="kpi">{product.unitsInStock}</div>
					<div className="label">in stock (v{product.version ?? "?"})</div>
				</div>
				<div className="card">
					<div className="kpi">{product.orderCount}</div>
					<div className="label">orders containing it</div>
				</div>
				<div className="card">
					<div className="kpi">
						<IdLink
							type="Supplier"
							id={String(product.supplierID ?? "")}
							label={product.supplier?.companyName ?? "—"}
						/>
					</div>
					<div className="label">
						supplier ({product.supplier?.country ?? "—"})
					</div>
				</div>
			</div>

			<div className="grid2" style={{ marginTop: 24 }}>
				<div>
					<h2>Sales over time</h2>
					<div className="panel" style={{ height: 260 }}>
						<ResponsiveContainer>
							<AreaChart
								data={sales}
								margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
							>
								<CartesianGrid stroke="#21262d" vertical={false} />
								<XAxis
									dataKey="month"
									tick={{ fill: "#8b949e", fontSize: 10 }}
								/>
								<YAxis
									yAxisId="orders"
									tick={{ fill: "#8b949e", fontSize: 10 }}
									width={30}
								/>
								<YAxis yAxisId="revenue" orientation="right" hide />
								<Tooltip
									contentStyle={{
										background: "#161b22",
										border: "1px solid #30363d",
										borderRadius: 6,
									}}
									formatter={(value, name) => [
										Number(value).toLocaleString(),
										String(name),
									]}
								/>
								<Area
									yAxisId="orders"
									dataKey="orders"
									stroke="#58a6ff"
									fill="#58a6ff22"
									strokeWidth={2}
								/>
								<Area
									yAxisId="revenue"
									dataKey="revenue"
									stroke="#3fb950"
									fill="#3fb95022"
									strokeWidth={2}
								/>
							</AreaChart>
						</ResponsiveContainer>
					</div>

					<h2>Top companies ordering it</h2>
					<table>
						<thead>
							<tr>
								<th>company</th>
								<th>orders</th>
								<th>revenue</th>
							</tr>
						</thead>
						<tbody>
							{companies.map((company) => (
								<tr key={company.customerID}>
									<td>
										<IdLink
											type="Customer"
											id={company.customerID}
											label={company.company}
										/>
									</td>
									<td>{company.orders}</td>
									<td>{company.revenue.toLocaleString()}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<div>
					<h2>People who also bought this also bought…</h2>
					<div className="panel">
						{alsoBought.map((row) => (
							<div key={row.productID} style={{ marginBottom: 8 }}>
								<div
									style={{ display: "flex", justifyContent: "space-between" }}
								>
									<span>
										<IdLink
											type="Product"
											id={row.productID}
											label={row.name}
										/>
									</span>
									<span className="muted">{row.times} shared orders</span>
								</div>
								<div
									className="bar"
									style={{
										width: `${(row.times / Math.max(1, alsoBought[0]?.times ?? 1)) * 100}%`,
									}}
								/>
							</div>
						))}
						{alsoBought.length === 0 && (
							<span className="muted">no co-purchases yet</span>
						)}
					</div>

					<h2>Similar by embedding (kNN)</h2>
					<table>
						<tbody>
							{detail.similar.map((hit) => (
								<tr key={nameOf(hit)}>
									<td>
										<IdLink
											type="Product"
											id={productIdOf(hit)}
											label={nameOf(hit)}
										/>
									</td>
									<td className="muted">similarity {hit.score.toFixed(3)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

function productIdOf(hit: unknown): number {
	const product = (hit as { product?: { productID?: number } }).product;

	return product?.productID ?? 0;
}

function nameOf(hit: unknown): string {
	const product = (hit as { product?: { name?: string } }).product;

	return product?.name ?? "?";
}

export function Orders() {
	const [feed, setFeed] = useState<CursorPage<OrderRow>>();
	const [error, setError] = useState("");
	const [detail, setDetail] = useState<{
		order: OrderRow;
		lines: {
			elementId?: string;
			product: Record<string, unknown>;
			line: Record<string, unknown>;
		}[];
	}>();
	const [lineError, setLineError] = useState("");

	const load = (): void => {
		void api
			.orders()
			.then(setFeed)
			.catch((problem: Error) => setError(problem.message));
	};

	useEffect(load, []);

	const openDetail = (id: number): void => {
		void api
			.orderLines(id)
			.then((result) =>
				setDetail({
					order:
						feed?.items.find((o) => o.orderID === id) ??
						({ orderID: id } as OrderRow),
					lines: result.lines,
				}),
			)
			.catch((problem: Error) => setLineError(problem.message));
	};

	const totalOf = (): number =>
		(detail?.lines ?? []).reduce((sum, entry) => {
			const line = entry.line as {
				quantity?: number;
				unitPrice?: number;
				discount?: number;
			};

			return (
				sum +
				(line.quantity ?? 0) *
					(line.unitPrice ?? 0) *
					(1 - (line.discount ?? 0))
			);
		}, 0);

	const changeLine = (elementId: string, delta: number): void => {
		const current = detail?.lines.find(
			(entry) => entry.elementId === elementId,
		);
		const quantity =
			Number((current?.line as { quantity?: number }).quantity ?? 1) + delta;

		void api
			.updateLine(elementId, { quantity })
			.then(() => openDetail(detail?.order.orderID ?? 0))
			.catch((problem: Error) => setLineError(problem.message));
	};

	return (
		<div>
			<h1>Order desk</h1>
			{error && <div className="error">{error}</div>}

			{detail && (
				<div className="panel">
					<h2>
						Order #{detail.order.orderID}
						<span className="muted"> — total {totalOf().toFixed(2)}</span>
					</h2>
					{lineError && <div className="error">{lineError}</div>}
					<table>
						<thead>
							<tr>
								<th>product</th>
								<th>unit price</th>
								<th>qty</th>
								<th>discount</th>
								<th>line total</th>
							</tr>
						</thead>
						<tbody>
							{detail.lines.map((entry, index) => {
								const line = entry.line as {
									quantity?: number;
									unitPrice?: number;
									discount?: number;
								};
								const product = entry.product as {
									name?: string;
									productID?: number;
								};

								return (
									<tr key={entry.elementId ?? index}>
										<td>{product.name ?? product.productID}</td>
										<td>{line.unitPrice}</td>
										<td>
											<button
												onClick={() =>
													entry.elementId !== undefined &&
													changeLine(entry.elementId, -1)
												}
											>
												−
											</button>{" "}
											{line.quantity}{" "}
											<button
												onClick={() =>
													entry.elementId !== undefined &&
													changeLine(entry.elementId, 1)
												}
											>
												+
											</button>
										</td>
										<td>{line.discount ?? 0}</td>
										<td>
											{(
												(line.quantity ?? 0) *
												(line.unitPrice ?? 0) *
												(1 - (line.discount ?? 0))
											).toFixed(2)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
					<button
						onClick={() =>
							void api.ship(detail.order.orderID).then(() => {
								setDetail(undefined);
								load();
							})
						}
					>
						ship
					</button>
					<button
						className="danger"
						onClick={() =>
							void api.cancel(detail.order.orderID).then(() => {
								setDetail(undefined);
								load();
							})
						}
					>
						cancel order
					</button>
					<button onClick={() => setDetail(undefined)}>close</button>
				</div>
			)}

			<table>
				<thead>
					<tr>
						<th>order</th>
						<th>date</th>
						<th>customer</th>
						<th>ship to</th>
						<th>status</th>
						<th>time to ship</th>
						<th />
					</tr>
				</thead>
				<tbody>
					{feed?.items.map((order) => (
						<tr key={order.orderID}>
							<td>
								<a onClick={() => openDetail(order.orderID)}>
									#{order.orderID}
								</a>
							</td>
							<td className="muted">{order.orderDate?.slice(0, 10)}</td>
							<td>{order.customer?.companyName ?? "—"}</td>
							<td className="muted">
								{order.shipCity}, {order.shipCountry}
							</td>
							<td>
								{order.shippedDate === undefined ||
								order.shippedDate === null ? (
									<span className="badge best">open</span>
								) : (
									<span className="badge ok">shipped</span>
								)}
							</td>
							<td className="muted">{String(order.timeToShip ?? "—")}</td>
							<td>
								{(order.shippedDate === undefined ||
									order.shippedDate === null) && (
									<button
										onClick={() => void api.ship(order.orderID).then(load)}
									>
										ship
									</button>
								)}
								<button
									className="danger"
									onClick={() => void api.cancel(order.orderID).then(load)}
								>
									cancel
								</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
			{feed?.hasMore && (
				<button
					onClick={() =>
						void api
							.orders(feed.nextCursor)
							.then((next) =>
								setFeed({ ...next, items: [...feed.items, ...next.items] }),
							)
					}
				>
					load more (cursor: {feed.nextCursor?.slice(0, 10)}…)
				</button>
			)}
		</div>
	);
}

export function Customers({ initialCustomer }: { initialCustomer?: string }) {
	const [customerID, setCustomerID] = useState(initialCustomer ?? "ANTON");
	const [profile, setProfile] = useState<{
		customer: Record<string, unknown>;
		history: OrderRow[];
	}>();
	const [error, setError] = useState("");

	const load = (id: string): void => {
		void api
			.customer(id)
			.then(setProfile)
			.catch((problem: Error) => setError(problem.message));
	};

	useEffect(() => {
		load(customerID);
	}, [customerID]);

	return (
		<div>
			<h1>Customer 360</h1>
			<div className="panel">
				<input
					value={customerID}
					onChange={(event) => setCustomerID(event.target.value.toUpperCase())}
					style={{ width: 100 }}
				/>
				<button className="primary" onClick={() => load(customerID)}>
					open
				</button>{" "}
				{["ANTON", "ALFKI", "AROUT"].map((preset) => (
					<button
						key={preset}
						onClick={() => {
							setCustomerID(preset);
							load(preset);
						}}
					>
						{preset}
					</button>
				))}
				{error && <div className="error">{error}</div>}
			</div>

			{profile && (
				<>
					<div className="cards">
						<div className="card">
							<div className="kpi">
								{String(profile.customer["orderCount"] ?? 0)}
							</div>
							<div className="label">orders (projected count)</div>
						</div>
						<div className="card">
							<div className="kpi">
								{String(profile.customer["country"] ?? "—")}
							</div>
							<div className="label">
								{String(profile.customer["companyName"] ?? "")}
							</div>
						</div>
					</div>

					<h2>Order history</h2>
					<table>
						<thead>
							<tr>
								<th>order</th>
								<th>date</th>
								<th>ship to</th>
								<th>status</th>
							</tr>
						</thead>
						<tbody>
							{profile.history.map((order) => (
								<tr key={order.orderID}>
									<td>#{order.orderID}</td>
									<td className="muted">{order.orderDate?.slice(0, 10)}</td>
									<td className="muted">
										{order.shipCity}, {order.shipCountry}
									</td>
									<td>
										{order.shippedDate ? (
											<span className="badge ok">shipped</span>
										) : (
											<span className="badge best">open</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</>
			)}
		</div>
	);
}

export function Inventory() {
	const [rows, setRows] = useState<ProductRow[]>([]);
	const [error, setError] = useState("");

	const load = (): void => {
		void api
			.catalog(1, "limit=100")
			.then((page) => setRows(page.items))
			.catch((problem: Error) => setError(problem.message));
	};

	useEffect(load, []);

	const alerts = rows.filter(
		(product) => product.unitsInStock === 0 || product.belowReorder > 0,
	);

	return (
		<div>
			<h1>Inventory alerts</h1>
			{error && <div className="error">{error}</div>}
			<div className="cards" style={{ marginBottom: 16 }}>
				<div className="card">
					<div className="kpi">{alerts.length}</div>
					<div className="label">
						products at/below reorder (from the @Expression projection)
					</div>
				</div>
			</div>
			<table>
				<thead>
					<tr>
						<th>product</th>
						<th>stock</th>
						<th>below reorder</th>
						<th>on order</th>
						<th />
					</tr>
				</thead>
				<tbody>
					{alerts.map((product) => (
						<tr key={product.productID}>
							<td>
								<IdLink
									type="Product"
									id={product.productID}
									label={product.name}
								/>
							</td>
							<td className={product.unitsInStock === 0 ? "error" : ""}>
								{product.unitsInStock}
							</td>
							<td>{product.belowReorder}</td>
							<td>{product.unitsOnOrder}</td>
							<td>
								<button
									onClick={() =>
										void api.restock(product.productID, 50).then(load)
									}
								>
									restock +50 (atomic)
								</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

interface OrgNode {
	employeeID: number;
	name: string;
	title: string;
	managerID: number | null;
	reports: string[];
	territories: number;
}

function TreeNode({
	node,
	nodes,
	depth,
}: {
	node: OrgNode;
	nodes: OrgNode[];
	depth: number;
}) {
	const [open, setOpen] = useState(depth < 1);

	const children = nodes.filter(
		(candidate) => candidate.managerID === node.employeeID,
	);

	return (
		<div
			style={{
				marginLeft: depth === 0 ? 0 : 20,
				borderLeft: depth === 0 ? "none" : "1px solid #30363d",
			}}
		>
			<div style={{ padding: "6px 10px" }}>
				{children.length > 0 ? (
					<button
						onClick={() => {
							setOpen(!open);
						}}
					>
						{open ? "−" : "+"}
					</button>
				) : (
					<span className="muted" style={{ marginLeft: 30, fontSize: 12 }}>
						◦
					</span>
				)}{" "}
				<strong>
					<IdLink type="Employee" id={node.employeeID} label={node.name} />
				</strong>{" "}
				<span className="muted">{node.title}</span>{" "}
				{node.territories > 0 && (
					<span className="badge ok">{node.territories} territories</span>
				)}{" "}
				{children.length > 0 && (
					<span className="badge best">{children.length} reports</span>
				)}
			</div>
			{open &&
				children.map((child) => (
					<TreeNode
						key={child.employeeID}
						node={child}
						nodes={nodes}
						depth={depth + 1}
					/>
				))}
		</div>
	);
}

export function OrgChart() {
	const [nodes, setNodes] = useState<OrgNode[]>();
	const [error, setError] = useState("");

	useEffect(() => {
		void api
			.org()
			.then(setNodes)
			.catch((problem: Error) => setError(problem.message));
	}, []);

	return (
		<div>
			<h1>Org chart — click to expand (REPORTS_TO hierarchy)</h1>
			{error && <div className="error">{error}</div>}
			{nodes === undefined && <div className="muted">loading…</div>}
			{nodes
				?.filter((node) => node.managerID === null)
				.map((root) => (
					<TreeNode key={root.employeeID} node={root} nodes={nodes} depth={0} />
				))}
		</div>
	);
}

export function Suppliers() {
	const [latitude, setLatitude] = useState("51.51");
	const [longitude, setLongitude] = useState("-0.13");
	const [suppliers, setSuppliers] = useState<Record<string, unknown>[]>([]);
	const [error, setError] = useState("");

	const presets: { name: string; lat: string; lon: string }[] = [
		{ name: "London HQ", lat: "51.51", lon: "-0.13" },
		{ name: "Tokyo", lat: "35.68", lon: "139.69" },
		{ name: "New Orleans", lat: "29.95", lon: "-90.07" },
		{ name: "Sydney", lat: "-33.87", lon: "151.21" },
	];

	return (
		<div>
			<h1>Supplier map (withinDistance)</h1>
			<div className="panel">
				{presets.map((preset) => (
					<button
						key={preset.name}
						onClick={() => {
							setLatitude(preset.lat);
							setLongitude(preset.lon);
						}}
					>
						{preset.name}
					</button>
				))}
				<div style={{ marginTop: 12 }}>
					lat{" "}
					<input
						value={latitude}
						onChange={(event) => setLatitude(event.target.value)}
						style={{ width: 90 }}
					/>
					lon{" "}
					<input
						value={longitude}
						onChange={(event) => setLongitude(event.target.value)}
						style={{ width: 90 }}
					/>
					<button
						className="primary"
						onClick={() => {
							void api
								.suppliersNear(Number(latitude), Number(longitude), 800)
								.then((result) => setSuppliers(result.suppliers))
								.catch((problem: Error) => setError(problem.message));
						}}
					>
						find suppliers within 800 km
					</button>
				</div>
				{error && <div className="error">{error}</div>}
			</div>
			<table>
				<thead>
					<tr>
						<th>supplier</th>
						<th>city</th>
						<th>country</th>
						<th>contact</th>
					</tr>
				</thead>
				<tbody>
					{suppliers.map((supplier) => (
						<tr key={String(supplier["supplierID"])}>
							<td>{String(supplier["companyName"])}</td>
							<td>{String(supplier["city"])}</td>
							<td>{String(supplier["country"])}</td>
							<td className="muted">{String(supplier["contactName"])}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function Console() {
	const [cypher, setCypher] = useState(
		"MATCH (p:Product) RETURN p.name AS name, p.unitPrice AS price ORDER BY price DESC LIMIT 5",
	);
	const [result, setResult] = useState<{
		columns: string[];
		rows: unknown[][];
	}>();
	const [ontology, setOntology] = useState("");
	const [plan, setPlan] = useState<unknown>();
	const [answer, setAnswer] = useState<{
		cypher: string;
		columns: string[];
		rows: unknown[][];
	}>();
	const [question, setQuestion] = useState("");
	const [explorer, setExplorer] = useState<{
		center: Record<string, unknown>;
		edges: { rel: Record<string, unknown>; node: Record<string, unknown> }[];
	}>();
	const [nlAvailable, setNlAvailable] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		void api
			.ontology()
			.then(setOntology)
			.catch(() => {});
		void api
			.health()
			.then((health) => setNlAvailable(health.nlCypher))
			.catch(() => {});
	}, []);

	const run = (): void => {
		void api
			.console(cypher)
			.then(setResult)
			.catch((problem: Error) => setError(problem.message));
	};

	const explain = (): void => {
		void api
			.explain(cypher)
			.then((plan) => setPlan(JSON.stringify(plan, null, 2)))
			.catch((problem: Error) => setError(problem.message));
	};

	return (
		<div>
			<h1>Cypher console</h1>
			<div className="grid2">
				<div>
					<textarea
						value={cypher}
						onChange={(event) => setCypher(event.target.value)}
					/>
					<button className="primary" onClick={run}>
						run (read-only)
					</button>
					<button onClick={explain}>explain</button>
					{error && <div className="error">{error}</div>}

					{result && (
						<table>
							<thead>
								<tr>
									{result.columns.map((column) => (
										<th key={column}>{column}</th>
									))}
								</tr>
							</thead>
							<tbody>
								{result.rows.map((row, index) => (
									<tr key={index}>
										{row.map((value, cell) => (
											<td key={cell}>
												{typeof value === "object"
													? JSON.stringify(value)
													: String(value)}
											</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
					)}

					{plan !== undefined && (
						<div
							className="panel"
							style={{
								whiteSpace: "pre-wrap",
								maxHeight: 300,
								overflow: "auto",
							}}
						>
							{typeof plan === "string" ? plan : JSON.stringify(plan, null, 2)}
						</div>
					)}

					{nlAvailable && (
						<div className="panel">
							<h2>Ask in English (ontology-grounded)</h2>
							<input
								style={{ width: "70%" }}
								placeholder="which country buys the most Chai?"
								value={question}
								onChange={(event) => setQuestion(event.target.value)}
							/>{" "}
							<button
								className="primary"
								onClick={() => {
									void api
										.ask(question)
										.then(setAnswer)
										.catch((problem: Error) => setError(problem.message));
								}}
							>
								ask
							</button>
							{answer && (
								<div>
									<div className="muted">generated: {answer.cypher}</div>
									<table>
										<tbody>
											{answer.rows.slice(0, 5).map((row, index) => (
												<tr key={index}>
													{row.map((value, cell) => (
														<td key={cell}>{String(value)}</td>
													))}
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</div>
					)}
				</div>

				<div>
					<h2>Graph explorer (1-hop)</h2>
					<div className="panel">
						<button
							onClick={() => {
								void api
									.explore("Product", "productID", "1")
									.then(setExplorer)
									.catch((problem: Error) => setError(problem.message));
							}}
						>
							explore Product 1
						</button>{" "}
						<button
							onClick={() => {
								void api
									.explore("Supplier", "supplierID", "1")
									.then(setExplorer)
									.catch((problem: Error) => setError(problem.message));
							}}
						>
							explore Supplier 1
						</button>
						{explorer && (
							<div className="feed">
								<div className="entry">
									<span className="ev">center:</span>{" "}
									{JSON.stringify(explorer.center).slice(0, 120)}
								</div>
								{explorer.edges.map((edge, index) => (
									<div className="entry" key={index}>
										<span className="ev">
											-[{String((edge.rel as { type?: string }).type)}]-&gt;
										</span>{" "}
										{JSON.stringify(edge.node).slice(0, 110)}
									</div>
								))}
							</div>
						)}
					</div>

					<h2>Live ontology (ontologyMarkdown)</h2>
					<div
						className="panel"
						style={{ maxHeight: 400, overflow: "auto", whiteSpace: "pre-wrap" }}
					>
						{ontology || "loading…"}
					</div>
				</div>
			</div>
		</div>
	);
}

export function Ops() {
	const [schema, setSchema] = useState<{
		drift: string;
		inspection: unknown;
	}>();
	const [statements, setStatements] = useState<QueryInspectorEntry[]>([]);
	const [loadResult, setLoadResult] = useState("");
	const [profileTree, setProfileTree] = useState("");

	const load = (): void => {
		void api
			.schema()
			.then(setSchema)
			.catch(() => {});
		void api
			.inspector()
			.then((result) => setStatements(result.statements))
			.catch(() => {});
	};

	useEffect(load, []);

	const slowest = [...statements]
		.sort((a, b) => b.duration - a.duration)
		.slice(0, 8);

	return (
		<div>
			<h1>Ops</h1>

			<div className="panel">
				<h2>Load test (FactoryBuilder → chunked UNWIND)</h2>
				<button
					onClick={() => {
						void api
							.loadTest(500)
							.then((result) =>
								setLoadResult(
									`${result.count} orders generated in ${result.ms}ms`,
								),
							)
							.catch((problem: Error) => setLoadResult(problem.message));
					}}
				>
					generate 500 synthetic orders
				</button>
				<button onClick={load}>refresh counts</button>
				{loadResult && <div className="muted">{loadResult}</div>}
			</div>

			<div className="panel">
				<h2>Schema drift (declared vs installed) + repair</h2>
				<div style={{ whiteSpace: "pre-wrap" }}>
					{schema?.drift || "loading…"}
				</div>
				<button
					onClick={() => {
						void api
							.repairDrift(false)
							.then((result) => {
								setSchema((previous) => ({
									...(previous ?? { inspection: undefined, drift: "" }),
									drift: result.report,
								}));
								return undefined;
							})
							.catch(() => {});
					}}
				>
					apply missing objects (never drops)
				</button>
			</div>

			<div className="panel">
				<h2>Index usage — PROFILE the analytics queries</h2>
				<button
					onClick={() => {
						void api
							.profile(
								'MATCH (p:Product) WHERE p.name CONTAINS "a" RETURN count(p)',
							)
							.then((tree) => setProfileTree(JSON.stringify(tree, null, 2)))
							.catch((problem: Error) => setProfileTree(problem.message));
					}}
				>
					profile a catalog query
				</button>
				{profileTree && (
					<div
						style={{ whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto" }}
					>
						{profileTree}
					</div>
				)}
			</div>

			<div className="panel">
				<h2>
					Query inspector — slowest of the last {statements.length} statements
				</h2>
				<table>
					<thead>
						<tr>
							<th>at</th>
							<th>ms</th>
							<th>cypher</th>
						</tr>
					</thead>
					<tbody>
						{slowest.map((entry, index) => (
							<tr key={index}>
								<td className="muted">{entry.at.slice(11, 23)}</td>
								<td>{entry.duration.toFixed(1)}</td>
								<td style={{ whiteSpace: "pre-wrap" }}>
									{entry.cypher.slice(0, 160)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
				<button onClick={load}>refresh</button>
			</div>
		</div>
	);
}
