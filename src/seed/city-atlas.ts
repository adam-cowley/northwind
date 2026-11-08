/**
City → coordinates for the demo's supplier map. The Northwind source data
carries no geography, so the seed stamps every supplier with its city's
coordinates — enough for a withinDistance() demo that feels real.
*/
const ATLAS: Record<string, { latitude: number; longitude: number }> = {
	Tokyo: { latitude: 35.68, longitude: 139.69 },
	Osaka: { latitude: 34.69, longitude: 135.5 },
	Oviedo: { latitude: 43.36, longitude: -5.85 },
	Melbourne: { latitude: -37.81, longitude: 144.96 },
	Manchester: { latitude: 53.48, longitude: -2.24 },
	Göteborg: { latitude: 57.71, longitude: 11.97 },
	"Sao Paulo": { latitude: -23.55, longitude: -46.63 },
	Berlin: { latitude: 52.52, longitude: 13.4 },
	"New Orleans": { latitude: 29.95, longitude: -90.07 },
	Frankfurt: { latitude: 50.11, longitude: 8.68 },
	Cuxhaven: { latitude: 53.87, longitude: 8.7 },
	Ravenna: { latitude: 44.42, longitude: 12.2 },
	Sandvika: { latitude: 59.89, longitude: 10.53 },
	London: { latitude: 51.51, longitude: -0.13 },
	"Ann Arbor": { latitude: 42.28, longitude: -83.74 },
	Bend: { latitude: 44.06, longitude: -121.31 },
	Stockholm: { latitude: 59.33, longitude: 18.07 },
	Paris: { latitude: 48.86, longitude: 2.35 },
	Boston: { latitude: 42.36, longitude: -71.06 },
	Singapore: { latitude: 1.35, longitude: 103.82 },
	Lyngby: { latitude: 55.77, longitude: 12.5 },
	Zaandam: { latitude: 52.44, longitude: 4.64 },
	Montréal: { latitude: 45.5, longitude: -73.57 },
	Montceau: { latitude: 46.67, longitude: 4.5 },
	Salerno: { latitude: 40.68, longitude: 14.77 },
	Annecy: { latitude: 45.9, longitude: 6.13 },
	Lappeenranta: { latitude: 61.06, longitude: 28.11 },
	Sydney: { latitude: -33.87, longitude: 151.21 },
	"Ste-Hyacinthe": { latitude: 45.63, longitude: -72.95 },
};

export function cityCoordinates(city: string): {
	latitude: number;
	longitude: number;
} {
	return ATLAS[city] ?? { latitude: 0, longitude: 0 };
}
