import { useEffect, useState } from "react";
import { api, type ProductRow } from "../api.js";

/**
NTS-534 — Product links view. Insight views follow this shape: pickers,
the find action, the result list. Registered in main.tsx's nav.
*/
interface Hop {
	from: string;
	type: string;
	to: string;
}

interface Link {
	via: string;
	hops: Hop[];
}

/** api.ts has no links entry (feature-owned file) — one local GET. */
function fetchLinks(a: number, b: number): Promise<Link[]> {
	return fetch(`/api/insight/links?a=${a}&b=${b}`).then((response) => {
		if (!response.ok)
			throw new Error(`${response.status} ${response.statusText}`);

		return response.json() as Promise<Link[]>;
	});
}

export function ProductLinks() {
	const [products, setProducts] = useState<ProductRow[]>([]);
	const [a, setA] = useState("1");
	const [b, setB] = useState("2");
	const [links, setLinks] = useState<Link[]>();
	const [error, setError] = useState("");

	useEffect(() => {
		void api
			.catalog(1, "limit=100")
			.then((page) => setProducts(page.items))
			.catch((problem: Error) => setError(problem.message));
	}, []);

	const load = (): void => {
		void fetchLinks(Number(a), Number(b))
			.then((result) => {
				setLinks(result);
				setError("");
			})
			.catch((problem: Error) => setError(problem.message));
	};

	const picker = (value: string, onChange: (next: string) => void) => (
		<select value={value} onChange={(event) => onChange(event.target.value)}>
			{products.map((product) => (
				<option key={product.productID} value={String(product.productID)}>
					{product.name} ({product.productID})
				</option>
			))}
		</select>
	);

	return (
		<div>
			<h1>Product links — how are two products connected?</h1>
			<div className="panel">
				{picker(a, setA)}
				{picker(b, setB)}
				<button className="primary" onClick={load}>
					find links
				</button>
				{error !== "" && <div className="error">{error}</div>}
			</div>

			{links !== undefined &&
				(links.length === 0 ? (
					<p className="muted">no connection found within the hop bound</p>
				) : (
					links.map((link) => (
						<div key={link.via} className="panel">
							<span className="badge">{link.via}</span>
							<div>
								<span className="badge">{link.hops[0]?.from}</span>
								{link.hops.map((hop) => (
									<span key={`${hop.type}-${hop.to}`}>
										<span className="muted"> —{hop.type}→ </span>
										<span className="badge">{hop.to}</span>
									</span>
								))}
							</div>
						</div>
					))
				))}
		</div>
	);
}
