/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { permissionsForMembership } from "./accessControl";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("legacy Member role compatibility", () => {
  it("accepts stored Member templates and keeps their fixed permissions", async () => {
    const t = convexTest(schema, modules);
    const membershipId = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Legacy Member" });
      const businessId = await ctx.db.insert("businesses", {
        name: "Compatibility test workspace",
        currency: "UGX",
        timezone: "Africa/Kampala",
        createdBy: userId,
        createdAt: Date.now(),
      });
      const roleId = await ctx.db.insert("workspaceRoles", {
        businessId,
        name: "Member",
        description: "Legacy default read-only role.",
        permissions: ["dashboard.view", "access.manage"],
        builtIn: "member",
        active: true,
        createdBy: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return await ctx.db.insert("memberships", {
        businessId,
        userId,
        role: "member",
        roleId,
        active: true,
        createdAt: Date.now(),
      });
    });

    const permissions = await t.run(async ctx => {
      const membership = await ctx.db.get("memberships", membershipId);
      if (!membership) throw new Error("Member fixture was not saved.");
      return await permissionsForMembership(ctx, membership);
    });

    expect(permissions).toEqual(["dashboard.view", "analytics.view"]);
  });
});
