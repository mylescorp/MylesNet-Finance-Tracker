/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("partner statement privacy", () => {
  it("returns only linked partner context and a bounded statement period", async () => {
    const t = convexTest(schema, modules);
    const { userId, businessId } = await t.run(async ctx => {
      const ownerId = await ctx.db.insert("users", { name: "Owner" });
      const partnerUserId = await ctx.db.insert("users", { name: "Partner" });
      const businessId = await ctx.db.insert("businesses", { name: "Partner Statement Workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: ownerId, createdAt: Date.now() });
      const partnerId = await ctx.db.insert("partners", { businessId, name: "Linked Partner", ownershipBps: 2500, active: true });
      await ctx.db.insert("memberships", { businessId, userId: partnerUserId, role: "partner", partnerId, active: true, createdAt: Date.now() });
      await ctx.db.insert("partners", { businessId, name: "Other Partner", ownershipBps: 7500, active: true });
      await ctx.db.insert("partnerOwnershipHistory", { businessId, partnerId, ownershipBps: 2500, effectiveOn: "2026-01-01", createdBy: ownerId, createdAt: Date.now(), idempotencyKey: "ownership-history-partner-001" });
      return { userId: partnerUserId, businessId };
    });
    const partner = t.withIdentity({ subject: userId });
    const statement = await partner.query(api.operations.partnerStatement, { businessId, from: "2026-10-01", toExclusive: "2026-11-01" });
    expect(statement).toMatchObject({ access: "ready", partner: "Linked Partner", ownershipBps: 2500, ownershipEffectiveOn: "2026-01-01", statementFrom: "2026-10-01", statementToExclusive: "2026-11-01" });
    if (statement.access !== "ready") throw new Error("Expected a partner-scoped statement.");
    expect(statement).not.toHaveProperty("businessId");
    expect(statement).not.toHaveProperty("sales");
    expect(statement).not.toHaveProperty("expenses");
    expect(statement).not.toHaveProperty("partners");
    expect(statement).not.toHaveProperty("Other Partner");
  });

  it("denies a linked partner from querying a different workspace", async () => {
    const t = convexTest(schema, modules);
    const { userId, businessId, otherBusinessId } = await t.run(async ctx => {
      const ownerId = await ctx.db.insert("users", { name: "Owner" });
      const partnerUserId = await ctx.db.insert("users", { name: "Partner" });
      const businessId = await ctx.db.insert("businesses", { name: "Partner Workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: ownerId, createdAt: Date.now() });
      const otherBusinessId = await ctx.db.insert("businesses", { name: "Other Workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: ownerId, createdAt: Date.now() });
      const partnerId = await ctx.db.insert("partners", { businessId, name: "Linked Partner", ownershipBps: 10000, active: true });
      await ctx.db.insert("memberships", { businessId, userId: partnerUserId, role: "partner", partnerId, active: true, createdAt: Date.now() });
      return { userId: partnerUserId, businessId, otherBusinessId };
    });
    const partner = t.withIdentity({ subject: userId });
    expect(await partner.query(api.operations.partnerStatement, { businessId: otherBusinessId, from: "2026-10-01", toExclusive: "2026-11-01" })).toEqual({ access: "restricted" });
    expect(await partner.query(api.operations.partnerStatement, { businessId, from: "2026-10-01", toExclusive: "2026-11-01" })).toMatchObject({ access: "ready", partner: "Linked Partner" });
  });
});
