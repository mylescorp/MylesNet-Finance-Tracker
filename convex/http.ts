import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { health, webhook } from "./centipidHttp";
import { receive as googleFormReceive } from "./googleFormHttp";

const http = httpRouter();

auth.addHttpRoutes(http);
http.route({ path: "/centipid", method: "GET", handler: health });
http.route({ path: "/centipid", method: "POST", handler: webhook });
http.route({ path: "/google-form", method: "POST", handler: googleFormReceive });

export default http;
