/** ISO-8601 duration between two ISO timestamps, minute precision. */
export function durationBetween(from: string, to: string): string {
	const seconds = Math.max(
		0,
		Math.floor((Date.parse(to) - Date.parse(from)) / 1000),
	);

	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	return `P${days}DT${hours}H${minutes}M`;
}
