import { useEffect, useState } from "react";
import { IdLink } from "../nav.js";

/**
NTS-538 — Reorder network view: a call-card per supplier with low-stock
products, each product badged with its open (unshipped) order count.
Insight views follow the BasketTwins shape; fetched directly — a one-shot
insight needs no api.ts entry.
*/
interface ReorderProduct {
	productID: number;
	name: string;
	stock: number;
	reorderLevel: number;
	unitsOnOrder: number;
	openOrders: number;
}

interface ReorderSupplier {
	supplierID: number;
	company: string;
	phone: string;
	country: string;
	products: ReorderProduct[];
}

export function ReorderNetwork() {
	const [suppliers, setSuppliers] = useState<ReorderSupplier[]>();
	const [error, setError] = useState("");

	useEffect(() => {
		fetch("/api/insight/reorder-network")
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`${response.status} ${await response.text()}`);
				}
				return response.json() as Promise<{ suppliers: ReorderSupplier[] }>;
			})
			.then((result) => {
				setSuppliers(result.suppliers);
				setError("");
			})
			.catch((problem: Error) => setError(problem.message));
	}, []);

	return (
		<div>
			<h1>Reorder network — who to call for low stock</h1>
			{error !== "" && <div className="error">{error}</div>}
			{suppliers !== undefined && suppliers.length === 0 && (
				<div className="muted">Nothing is at or below its reorder level.</div>
			)}
			{suppliers !== undefined && suppliers.length > 0 && (
				<div className="cards">
					{suppliers.map((supplier) => (
						<div className="card" key={supplier.supplierID}>
							<h3>{supplier.company}</h3>
							<div className="muted">
								{supplier.country} · {supplier.phone}
							</div>
							{supplier.products.map((product) => (
								<div key={product.productID} style={{ marginTop: 8 }}>
									<IdLink
										type="Product"
										id={product.productID}
										label={product.name}
									/>
									<span className="muted">
										stock {product.stock}/{product.reorderLevel}, on order{" "}
										{product.unitsOnOrder}
									</span>{" "}
									<span className="badge">{product.openOrders} open</span>
								</div>
							))}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
