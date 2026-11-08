/**
Model registration — importing this module registers every model,
decorators and map-API alike (both front doors feed one metamodel).

The map-API files (map-models/) also double as the withDirectory()
showcase: the test suite loads that directory onto a fresh instance to
prove the file-scanning path registers them without an import.
*/
export { Category } from "./category.js";
export { Customer } from "./customer.js";
export { Employee } from "./employee.js";
export { Order } from "./order.js";
export { OrderLine } from "./order-line.js";
export { Product } from "./product.js";
export { Shipper } from "./shipper.js";
export { Supplier } from "./supplier.js";
export { Region } from "./map-models/region.js";
export { Territory } from "./map-models/territory.js";
