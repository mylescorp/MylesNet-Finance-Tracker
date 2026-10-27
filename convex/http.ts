import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { health, webhook } from "./centipidHttp";

const http = httpRouter();

auth.addHttpRoutes(http);
http.route({ path: "/centipid", method: "GET", handler: health });
http.route({ path: "/centipid", method: "POST", handler: webhook });

export default http;
