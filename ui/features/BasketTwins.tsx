import { useState } from "react";
import { IdLink } from "../nav.js";
import { api } from "../api.js";

/**
NTS-531 — Basket twins view. Insight views follow this shape: a picker,
the insight list, bars for magnitude. Registered in main.tsx's nav.
*/
interface Twin {
	id: string;
	company: string;
	country: string;
	sharedProducts: number;
	myProducts: number;
	jaccard: number;
}

export function BasketTwins() {
	const [customerId, setCustomerId] = useState("ANTON");
	const [twins, setTwins] = useState<Twin[]>();
	const [error, setError] = useState("");

	const load = (id: string): void => {
		void api
			.twins(id)
			.then((result) => {
				setTwins(result.twins);
				setError("");
			})
			.catch((problem: Error) => setError(problem.message));
	};

	return (
		<div>
			<h1>Basket twins — customers who buy like you</h1>
			<div className="panel">
				<input
					value={customerId}
					onChange={(event) => setCustomerId(event.target.value.toUpperCase())}
					style={{ width: 100 }}
				/>
				<button className="primary" onClick={() => load(customerId)}>
					find twins
				</button>{" "}
				{["ANTON", "ALFKI", "SAVEA"].map((preset) => (
					<button
						key={preset}
						onClick={() => {
							setCustomerId(preset);
							load(preset);
						}}
					>
						{preset}
					</button>
				))}
				{error !== "" && <div className="error">{error}</div>}
			</div>

			{twins !== undefined && (
				<table>
					<thead>
						<tr>
							<th>customer</th>
							<th>country</th>
							<th>shared products</th>
							<th>basket overlap (Jaccard)</th>
						</tr>
					</thead>
					<tbody>
						{twins.map((twin) => (
							<tr key={twin.id}>
								<td>
									<IdLink type="Customer" id={twin.id} label={twin.company} />
								</td>
								<td>{twin.country}</td>
								<td>{twin.sharedProducts}</td>
								<td style={{ minWidth: 220 }}>
									<div className="bar" style={{ width: `${twin.jaccard}%` }} />
									<span className="muted"> {twin.jaccard}%</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}
