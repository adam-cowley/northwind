// Deterministic read-model labels, applied server-side.
MATCH (p:Product)<-[line:CONTAINS]-()
WITH p, sum(line.quantity) AS ordered
ORDER BY ordered DESC
LIMIT 10
SET p:Bestseller
RETURN count(p) AS bestsellers;
