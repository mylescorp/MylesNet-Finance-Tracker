import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: { OWNER_SETUP_CODE: v.optional(v.string()) },
});
