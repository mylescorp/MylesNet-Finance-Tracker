import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { health, webhook } from "./centipidHttp";
import { receive as googleFormReceive } from "./googleFormHttp";
import { download as expenseReceiptDownload, preflight as expenseReceiptPreflight, upload as expenseReceiptUpload } from "./expenseReceiptHttp";

const http = httpRouter();

auth.addHttpRoutes(http);
http.route({ path: "/centipid", method: "GET", handler: health });
http.route({ path: "/centipid", method: "POST", handler: webhook });
http.route({ path: "/google-form", method: "POST", handler: googleFormReceive });
http.route({ path: "/expense-receipt", method: "OPTIONS", handler: expenseReceiptPreflight });
http.route({ path: "/expense-receipt", method: "POST", handler: expenseReceiptUpload });
http.route({ path: "/expense-receipt", method: "GET", handler: expenseReceiptDownload });

export default http;
