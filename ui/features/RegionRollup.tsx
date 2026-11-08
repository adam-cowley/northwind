import { useCallback, useEffect, useState } from "react";

/**
NTS-540 — Region rollup view: one card per region — kpi chips for the
counts, the employees covering its territories, and a revenue bar
relative to the biggest region. Fetches directly (no picker), like
CategoryAffinity; insight views follow BasketTwins' shape.
*/
interface RegionRow {
	regionID: number;
	name: string;
	territories: number;
	employees: string[];
	orders: number;
	revenue: number;
}

export function RegionRollup() {
	const [regions, setRegions] = useState<RegionRow[]>();
	const [error, setError] = useState("");

	const load = useCallback((): void => {
		void fetch("/api/insight/regions")
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`${response.status} ${await response.text()}`);
				}
				return response.json() as Promise<{ regions: RegionRow[] }>;
			})
			.then((result) => {
				setRegions(result.regions);
				setError("");
			})
			.catch((problem: Error) => setError(problem.message));
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const max = regions
		? Math.max(...regions.map((region) => region.revenue), 1)
		: 1;

	return (
		<div>
			<h1>Region rollup — revenue through the territory hierarchy</h1>
			<div className="panel">
				<button className="primary" onClick={load}>
					refresh
				</button>
				{error !== "" && <div className="error">{error}</div>}
			</div>

			<div className="cards">
				{regions?.map((region) => (
					<div className="card" key={region.regionID} style={{ minWidth: 260 }}>
						<h2>{region.name}</h2>
						<div className="kpi">
							{Math.round(region.revenue).toLocaleString()}
						</div>
						<div className="label">revenue</div>
						<p>
							<span className="badge">{region.territories} territories</span>{" "}
							<span className="badge">{region.employees.length} employees</span>{" "}
							<span className="badge">{region.orders} orders</span>
						</p>
						<div
							className="bar"
							style={{ width: `${(region.revenue / max) * 100}%` }}
						/>
						<p className="label">
							{region.employees.join(", ") || "no employees"}
						</p>
					</div>
				))}
			</div>
		</div>
	);
}
