import { useEffect, useState } from "react";
import { IdLink } from "../nav.js";

/**
NTS-541b — Countries insight: which countries order what. Click a
country row to drill into its product mix (ranked by revenue).
*/
interface CountryRow {
	country: string;
	orders: number;
	revenue: number;
	products: number;
}

interface ProductMix {
	productID: number;
	name: string;
	orders: number;
	revenue: number;
}

export function CountryInsight() {
	const [countries, setCountries] = useState<CountryRow[]>();
	const [selected, setSelected] = useState<string | undefined>(undefined);
	const [mix, setMix] = useState<ProductMix[]>([]);
	const [error, setError] = useState("");

	useEffect(() => {
		void fetch("/api/insight/countries")
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`${response.status} ${await response.text()}`);
				}
				return response.json() as Promise<{ countries: CountryRow[] }>;
			})
			.then((result) => setCountries(result.countries))
			.catch((problem: Error) => setError(problem.message));
	}, []);

	const drill = (country: string): void => {
		const next = selected === country ? undefined : country;

		setSelected(next);
		setMix([]);

		if (next === undefined) {
			return;
		}

		void fetch(`/api/insight/countries/${encodeURIComponent(next)}`)
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`${response.status} ${await response.text()}`);
				}
				return response.json() as Promise<{ products: ProductMix[] }>;
			})
			.then((result) => setMix(result.products))
			.catch((problem: Error) => setError(problem.message));
	};

	const max = countries
		? Math.max(...countries.map((row) => row.revenue), 1)
		: 1;

	return (
		<div>
			<h1>Countries — who orders what</h1>
			{error !== "" && <div className="error">{error}</div>}

			{countries !== undefined && (
				<table>
					<thead>
						<tr>
							<th>ship-to country</th>
							<th>orders</th>
							<th>revenue</th>
							<th>distinct products</th>
						</tr>
					</thead>
					<tbody>
						{countries.map((row) => (
							<tr
								key={row.country}
								style={{ cursor: "pointer" }}
								onClick={() => {
									drill(row.country);
								}}
							>
								<td>
									{selected === row.country ? "▾ " : "▸ "}
									<strong>{row.country}</strong>
								</td>
								<td>{row.orders}</td>
								<td style={{ minWidth: 200 }}>
									<div
										className="bar"
										style={{
											width: `${Math.round((100 * row.revenue) / max)}%`,
										}}
									/>
									<span className="muted"> {row.revenue.toLocaleString()}</span>
								</td>
								<td>{row.products}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}

			{selected !== undefined && (
				<div className="panel">
					<h2>What {selected} buys</h2>
					{mix.length === 0 ? (
						<span className="muted">loading…</span>
					) : (
						<table>
							<thead>
								<tr>
									<th>product</th>
									<th>orders</th>
									<th>revenue</th>
								</tr>
							</thead>
							<tbody>
								{mix.map((product) => (
									<tr key={product.productID}>
										<td>
											<IdLink
												type="Product"
												id={product.productID}
												label={product.name}
											/>
										</td>
										<td>{product.orders}</td>
										<td>{product.revenue.toLocaleString()}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			)}
		</div>
	);
}
