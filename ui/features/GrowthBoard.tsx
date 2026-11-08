import { useState } from "react";

/**
NTS-535 — Growth board view: MoM risers (green) vs fallers (red) for one
month. Insight views follow the BasketTwins shape — inputs, a load button,
bars for magnitude.
*/
interface Movement {
	productID: number;
	name: string;
	month: string;
	revenue: number;
	previousRevenue: number;
	delta: number;
}

interface Board {
	month: string | null;
	risers: Movement[];
	fallers: Movement[];
}

export function GrowthBoard() {
	const [month, setMonth] = useState("");
	const [board, setBoard] = useState<Board>();
	const [error, setError] = useState("");

	const load = (which: string): void => {
		const query = which === "" ? "" : `?month=${encodeURIComponent(which)}`;
		void fetch(`/api/insight/growth${query}`)
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`${response.status} ${await response.text()}`);
				}
				return response.json() as Promise<Board>;
			})
			.then((result) => {
				setBoard(result);
				setError("");
			})
			.catch((problem: Error) => setError(problem.message));
	};

	const column = (title: string, rows: Movement[], color: string) => {
		const widest = Math.max(...rows.map((row) => Math.abs(row.delta)), 1);
		return (
			<div style={{ flex: 1 }}>
				<h2>{title}</h2>
				<table>
					<tbody>
						{rows.map((row) => (
							<tr key={row.productID}>
								<td>
									{row.name} <span className="muted">({row.productID})</span>
									<br />
									<span className="muted">
										{row.revenue} vs {row.previousRevenue}
									</span>
								</td>
								<td style={{ minWidth: 220 }}>
									<div
										className="bar"
										style={{
											width: `${(Math.abs(row.delta) / widest) * 100}%`,
											backgroundColor: color,
										}}
									/>
									<span className="muted">
										{" "}
										{row.delta > 0 ? "+" : ""}
										{row.delta}
									</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	};

	return (
		<div>
			<h1>Growth board — month-over-month risers and fallers</h1>
			<div className="panel">
				<input
					value={month}
					placeholder="YYYY-MM (blank = latest)"
					onChange={(event) => setMonth(event.target.value.trim())}
					style={{ width: 180 }}
				/>
				<button className="primary" onClick={() => load(month)}>
					load board
				</button>{" "}
				<button
					onClick={() => {
						setMonth("");
						load("");
					}}
				>
					latest
				</button>
				{error !== "" && <div className="error">{error}</div>}
			</div>

			{board !== undefined && (
				<p className="muted">
					month {board.month} — {board.risers.length} risers,{" "}
					{board.fallers.length} fallers
				</p>
			)}
			<div style={{ display: "flex", gap: 40 }}>
				{board !== undefined && column("RISERS", board.risers, "#2e9e4f")}
				{board !== undefined && column("FALLERS", board.fallers, "#c0392b")}
			</div>
		</div>
	);
}
