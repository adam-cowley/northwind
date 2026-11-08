import { useCallback, useEffect, useState } from "react";

/**
NTS-533 — Category affinity view: an NxN heatmap of which categories
are bought together. Insight views follow BasketTwins' shape; this one
fetches directly (no query param to pick), so 401s surface as errors.
*/
interface Pair {
	categoryA: string;
	categoryB: string;
	sharedOrders: number;
}

export function CategoryAffinity() {
	const [pairs, setPairs] = useState<Pair[]>();
	const [error, setError] = useState("");

	const load = useCallback((): void => {
		void fetch("/api/insight/affinity")
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`${response.status} ${await response.text()}`);
				}
				return response.json() as Promise<{ pairs: Pair[] }>;
			})
			.then((result) => {
				setPairs(result.pairs);
				setError("");
			})
			.catch((problem: Error) => setError(problem.message));
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const names = pairs
		? [
				...new Set(pairs.flatMap((pair) => [pair.categoryA, pair.categoryB])),
			].sort()
		: [];
	// The traversal counts each direction; fill both halves of the matrix.
	const matrix = new Map<string, number>();
	const max = pairs
		? Math.max(...pairs.map((pair) => pair.sharedOrders), 1)
		: 1;

	if (pairs) {
		for (const pair of pairs) {
			matrix.set(`${pair.categoryA}|${pair.categoryB}`, pair.sharedOrders);
			matrix.set(`${pair.categoryB}|${pair.categoryA}`, pair.sharedOrders);
		}
	}

	const cell = (row: string, column: string): number =>
		row === column ? -1 : (matrix.get(`${row}|${column}`) ?? 0);

	return (
		<div>
			<h1>Category affinity — what is bought together</h1>
			<div className="panel">
				<button className="primary" onClick={load}>
					refresh
				</button>
				{error !== "" && <div className="error">{error}</div>}
			</div>

			{pairs !== undefined && (
				<div
					style={{
						display: "grid",
						gridTemplateColumns: `minmax(90px, auto) repeat(${names.length}, minmax(60px, 1fr))`,
						gap: 2,
						maxWidth: 900,
					}}
				>
					<span />
					{names.map((name) => (
						<span
							key={`head-${name}`}
							className="muted"
							style={{ fontSize: 11 }}
						>
							{name}
						</span>
					))}
					{names.map((row) => (
						<>
							<span
								key={`row-${row}`}
								className="muted"
								style={{ fontSize: 11 }}
							>
								{row}
							</span>
							{names.map((column) => {
								const value = cell(row, column);
								const alpha = value <= 0 ? 0 : 0.15 + 0.85 * (value / max);
								return (
									<div
										key={`cell-${row}-${column}`}
										title={
											row === column
												? row
												: `${row} × ${column}: ${value} shared orders`
										}
										style={{
											height: 36,
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											fontSize: 11,
											color:
												alpha > 0.55
													? "#fff"
													: value <= 0
														? "#8b949e"
														: "#e6edf3",
											background:
												value < 0 ? "#eee" : `rgba(37, 99, 235, ${alpha})`,
											borderRadius: 3,
										}}
									>
										{row !== column && value > 0 ? value : ""}
									</div>
								);
							})}
						</>
					))}
				</div>
			)}
		</div>
	);
}
