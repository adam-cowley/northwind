import { useEffect, useState } from "react";

/**
NTS-537 — Shipper coverage view: three shipper cards (orders, revenue,
countries) plus the dominance table — which shipper carries the most
orders to each ship-to country. Insight views follow this shape:
a panel, the data, tables for lists, bars for magnitude.
*/
interface ShipperTotals {
	shipperID: number;
	name: string;
	phone: string;
	orders: number;
	revenue: number;
	countries: number;
}

interface DominanceRow {
	country: string;
	shipper: number;
	orders: number;
}

export function ShipperCoverage() {
	const [data, setData] = useState<{
		shippers: ShipperTotals[];
		dominance: DominanceRow[];
	}>();
	const [error, setError] = useState("");

	useEffect(() => {
		fetch("/api/insight/shippers")
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`${response.status} ${await response.text()}`);
				}
				return response.json() as Promise<{
					shippers: ShipperTotals[];
					dominance: DominanceRow[];
				}>;
			})
			.then((result) => setData(result))
			.catch((problem: Error) => setError(problem.message));
	}, []);

	return (
		<div>
			<h1>Shipper coverage — who ships where</h1>
			{error !== "" && <div className="error">{error}</div>}

			{data !== undefined && (
				<>
					<div className="cards">
						{data.shippers.map((shipper) => (
							<div className="card" key={shipper.shipperID}>
								<div className="kpi">{shipper.orders}</div>
								<div className="label">orders</div>
								<div style={{ marginTop: 8 }}>
									<strong>{shipper.name}</strong>{" "}
									<span className="muted">({shipper.shipperID})</span>
								</div>
								<div className="muted">{shipper.phone}</div>
								<div style={{ marginTop: 8 }}>
									revenue shipped{" "}
									<span className="kpi">
										${Math.round(shipper.revenue).toLocaleString()}
									</span>
								</div>
								<div>
									distinct countries{" "}
									<span className="kpi">{shipper.countries}</span>
								</div>
							</div>
						))}
					</div>

					<h2>Dominance — the carrier with the most orders, per country</h2>
					<table>
						<thead>
							<tr>
								<th>ship-to country</th>
								<th>dominant shipper</th>
								<th>orders</th>
							</tr>
						</thead>
						<tbody>
							{data.dominance.map((row) => (
								<tr key={row.country}>
									<td>{row.country}</td>
									<td>
										{data.shippers.find(
											(shipper) => shipper.shipperID === row.shipper,
										)?.name ?? `Shipper ${row.shipper}`}
									</td>
									<td>
										<span className="muted">{row.orders}</span>
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
