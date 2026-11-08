/** Typed fetch helpers over the Northwind Ops API. */

export interface Page<T> {
	items: T[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}

export interface CursorPage<T> {
	items: T[];
	nextCursor?: string;
	hasMore: boolean;
}

async function get<T>(path: string): Promise<T> {
	const response = await fetch(path);

	if (response.status === 401) {
		window.location.href = "/login";
		throw new Error("unauthorized");
	}

	if (!response.ok) {
		throw new Error(`${response.status} ${await response.text()}`);
	}

	return response.json() as Promise<T>;
}

async function send<T>(
	path: string,
	method: string,
	body?: unknown,
): Promise<T> {
	const response = await fetch(path, {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

	if (response.status === 401) {
		window.location.href = "/login";
		throw new Error("unauthorized");
	}

	if (!response.ok) {
		throw new Error(`${response.status} ${await response.text()}`);
	}

	return response.json() as Promise<T>;
}

export interface ProductRow {
	productID: number;
	name: string;
	unitPrice: number;
	unitsInStock: number;
	discontinued: boolean;
	unitsOnOrder: number;
	supplierID: number;
	supplier?: { companyName: string; country: string };
	category?: { name: string };
	orderCount: number;
	hasBeenOrdered: boolean;
	isBestseller: boolean;
	belowReorder: number;
	inStock: boolean;
	version?: number;
	_labels?: string[];
}

export interface OrderRow {
	orderID: number;
	orderDate: string;
	shippedDate?: string;
	shipCountry: string;
	shipCity: string;
	freight: number;
	timeToShip?: string;
	customer?: { customerID: string; companyName: string; country: string };
	_labels?: string[];
}

export const api = {
	catalog: (page = 1, extra = "") =>
		get<Page<ProductRow>>(
			`/api/catalog?page=${page}${extra ? `&${extra}` : ""}`,
		),
	product: (id: number) =>
		get<{ product: ProductRow; similar: { score: number }[] }>(
			`/api/products/${id}`,
		),
	updateProduct: (id: number, body: Partial<ProductRow>) =>
		send<ProductRow>(`/api/products/${id}`, "PUT", body),
	upsertProduct: (body: Record<string, unknown>) =>
		send<ProductRow>("/api/products/0", "PUT", body),
	discontinue: (id: number) =>
		send<ProductRow>(`/api/products/${id}/discontinue`, "POST"),
	restock: (id: number, by: number) =>
		send<{ unitsInStock: number }>(`/api/products/${id}/restock`, "POST", {
			by,
		}),
	search: (q: string) =>
		get<{ text: { score: number }[]; similar: { score: number }[] }>(
			`/api/search?q=${encodeURIComponent(q)}`,
		),
	orders: (after?: string) =>
		get<CursorPage<OrderRow>>(
			`/api/orders${after ? `?after=${encodeURIComponent(after)}` : ""}`,
		),
	order: (id: number) =>
		get<{
			order: OrderRow;
			lines: {
				product: Record<string, unknown>;
				line: Record<string, unknown>;
			}[];
		}>(`/api/orders/${id}`),
	placeOrder: (body: unknown) => send<OrderRow>("/api/orders", "POST", body),
	ship: (id: number) => send<OrderRow>(`/api/orders/${id}/ship`, "POST"),
	cancel: (id: number) =>
		send<{ cancelled: boolean }>(`/api/orders/${id}`, "DELETE"),
	customer: (id: string) =>
		get<{ customer: Record<string, unknown>; history: OrderRow[] }>(
			`/api/customers/${id}`,
		),
	suppliersNear: (lat: number, lon: number, radius = 500) =>
		get<{ suppliers: Record<string, unknown>[] }>(
			`/api/suppliers/near?lat=${lat}&lon=${lon}&radius=${radius}`,
		),
	revenueByCountry: () =>
		get<{ country: string; revenue: number; orders: number }[]>(
			"/api/analytics/revenue-by-country",
		),
	topProducts: () =>
		get<{ name: string; stock: number; revenue: number }[]>(
			"/api/analytics/top-products",
		),
	console: (cypher: string) =>
		send<{ columns: string[]; rows: unknown[][] }>("/api/console", "POST", {
			cypher,
		}),
	ontology: () => fetch("/api/ontology").then((r) => r.text()),
	schema: () => get<{ inspection: unknown; drift: string }>("/api/schema"),
	inspector: () => get<{ statements: QueryInspectorEntry[] }>("/api/inspector"),
	health: () => get<{ ok: boolean; nlCypher: boolean }>("/api/health"),
	// Second act
	orderLines: (id: number) =>
		get<{
			lines: {
				elementId?: string;
				productID: number;
				name: string;
				unitPrice: number;
				quantity: number;
				discount: number;
			}[];
		}>(`/api/orders/${id}`),
	updateLine: (
		elementId: string,
		patch: { quantity?: number; discount?: number },
	) =>
		send<{ line: Record<string, unknown> }>(
			`/api/order-lines/${encodeURIComponent(elementId)}`,
			"PATCH",
			patch,
		),
	updatePrices: (updates: { productID: number; factor: number }[]) =>
		send<{ applied: number }>("/api/products/price-update", "POST", {
			updates,
		}),
	importProducts: (rows: Record<string, unknown>[]) =>
		send<{ imported: number; chunks: number }>("/api/products/import", "POST", {
			rows,
		}),
	explain: (q: string) =>
		fetch(`/api/explain?q=${encodeURIComponent(q)}`).then((r) => r.json()),
	profile: (cypher: string) =>
		send<unknown>("/api/profile", "POST", { cypher }),
	repairDrift: (dropStale: boolean) =>
		send<{ report: string }>("/api/schema/repair", "POST", { dropStale }),
	loadTest: (count: number) =>
		send<{ count: number; ms: number }>("/api/load-test", "POST", { count }),
	explore: (type: string, pk: string, id: string) =>
		get<{
			center: Record<string, unknown>;
			edges: { rel: Record<string, unknown>; node: Record<string, unknown> }[];
		}>(`/api/explore?type=${type}&pk=${pk}&id=${encodeURIComponent(id)}`),
	ask: (question: string) =>
		send<{ cypher: string; columns: string[]; rows: unknown[][] }>(
			"/api/ask",
			"POST",
			{ question },
		),
	ordersOverTime: () =>
		get<{ month: string; orders: number; revenue: number }[]>(
			"/api/analytics/orders-over-time",
		),
	org: () =>
		get<
			{
				employeeID: number;
				name: string;
				title: string;
				managerID: number | null;
				reports: string[];
				territories: number;
			}[]
		>("/api/org"),
	productSalesOverTime: (id: number) =>
		get<{ month: string; orders: number; revenue: number }[]>(
			`/api/products/${id}/sales-over-time`,
		),
	topCompanies: (id: number) =>
		get<
			{ customerID: string; company: string; orders: number; revenue: number }[]
		>(`/api/products/${id}/companies`),
	alsoBought: (id: number) =>
		get<{ productID: number; name: string; times: number }[]>(
			`/api/products/${id}/also-bought`,
		),
	upsell: (orderId: number) =>
		get<{
			opportunities: {
				productID: number;
				name: string;
				unitPrice: number;
				times: number;
			}[];
		}>(`/api/orders/${orderId}/upsell`),
	addLine: (
		orderId: number,
		line: { productID: number; quantity?: number; discount?: number },
	) => send<{ added: boolean }>(`/api/orders/${orderId}/lines`, "POST", line),
	twins: (customerId: string) =>
		get<{
			customer: string;
			twins: {
				id: string;
				company: string;
				country: string;
				sharedProducts: number;
				myProducts: number;
				jaccard: number;
			}[];
		}>(`/api/insight/twins/${customerId}`),
};

export interface QueryInspectorEntry {
	cypher: string;
	duration: number;
	at: string;
}
