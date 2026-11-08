/**
The line-revenue expression (NTS-556): the CONTAINS edge carries the
purchase-time state, so every revenue aggregation prices its lines the
same way. Interpolate into a return/WITH string and wrap it in
`round(sum(...))` (or sum a WITH alias) as the site needs.
*/
export const LINE_REVENUE =
	"line.quantity * line.unitPrice * (1 - line.discount)";
