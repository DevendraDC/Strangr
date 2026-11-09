import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [index("routes/home.tsx"), route("/room/:id", "routes/room.tsx")] satisfies RouteConfig;
