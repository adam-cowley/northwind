import { useEffect, useState } from "react";
import { IdLink } from "../nav.js";

/**
NTS-532 — Supply-chain exposure view: a ranked exposure list (bars for
magnitude) with click-to-drill into a supplier's contact info and affected
customers. Registered in main.tsx's nav. Direct fetch — same-origin
cookies flow automatically, 401s redirect to /login.
*/
interface SupplierExposure {
	id: number;
	company: string;
	country: string;
	products: number;
	orders: number;
	customers: number;
}

interface ExposureDrill {
	supplier: {
		id: number;
		company: string;
		contactName: string;
		contactTitle: string;
		phone: string;
		street: string;
		city: string;
		region: string;
		country: string;
		postalCode: string;
	};
	products: { id: number; name: string; stock: number }[];
	orders: number;
	customers: { id: string; company: string; country: string }[];
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

export function SupplyExposure() {
	const [suppliers, setSuppliers] = useState<SupplierExposure[]>();
	const [drill, setDrill] = useState<ExposureDrill>();
	const [error, setError] = useState("");

	useEffect(() => {
		void get<{ suppliers: SupplierExposure[] }>("/api/insight/supply-exposure")
			.then((result) => setSuppliers(result.suppliers))
			.catch((problem: Error) => setError(problem.message));
	}, []);

	const load = (id: number): void => {
		void get<ExposureDrill>(`/api/insight/supply-exposure/${id}`)
			.then((result) => {
				setDrill(result);
				setError("");
			})
			.catch((problem: Error) => setError(problem.message));
	};

	const max = Math.max(1, ...(suppliers ?? []).map((s) => s.customers));

	return (
		<div>
			<h1>Supply-chain exposure — who is at risk if a supplier goes down</h1>
			{error !== "" && <div className="error">{error}</div>}

			{suppliers !== undefined && (
				<table>
					<thead>
						<tr>
							<th>supplier</th>
							<th>country</th>
							<th>products</th>
							<th>orders</th>
							<th>customers at risk</th>
						</tr>
					</thead>
					<tbody>
						{suppliers.map((supplier) => (
							<tr
								key={supplier.id}
								onClick={() => load(supplier.id)}
								style={{ cursor: "pointer" }}
							>
								<td>
									<IdLink
										type="Supplier"
										id={supplier.id}
										label={supplier.company}
									/>
								</td>
								<td>{supplier.country}</td>
								<td>{supplier.products}</td>
								<td>{supplier.orders}</td>
								<td style={{ minWidth: 220 }}>
									<div
										className="bar"
										style={{
											width: `${(100 * supplier.customers) / max}%`,
										}}
									/>
									<span className="muted"> {supplier.customers}</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}

			{drill !== undefined && (
				<div className="panel">
					<h2>
						<IdLink
							type="Supplier"
							id={drill.supplier.id}
							label={drill.supplier.company}
						/>
					</h2>
					<div className="muted">
						{drill.supplier.contactName} · {drill.supplier.contactTitle} ·{" "}
						{drill.supplier.phone}
					</div>
					<div className="muted">
						{drill.supplier.street}, {drill.supplier.city}
						{drill.supplier.region !== "" ? `, ${drill.supplier.region}` : ""}{" "}
						{drill.supplier.postalCode}, {drill.supplier.country}
					</div>
					<p>
						{drill.products.length} products · {drill.orders} orders ·{" "}
						{drill.customers.length} distinct customers affected
					</p>
					<div style={{ display: "flex", gap: 32 }}>
						<div>
							<h3>products</h3>
							{drill.products.map((product) => (
								<div key={product.id}>
									{product.name}{" "}
									<span className="muted">({product.stock} in stock)</span>
								</div>
							))}
						</div>
						<div>
							<h3>customers at risk</h3>
							{drill.customers.map((customer) => (
								<div key={customer.id}>
									{customer.company}{" "}
									<span className="muted">
										({customer.id}, {customer.country})
									</span>
								</div>
							))}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
