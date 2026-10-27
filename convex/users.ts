import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not signed in");
    }
    const user = await ctx.db.get("users", userId);
    if (user === null) {
      throw new Error("User was deleted");
    }
    return user;
  },
});

export const profile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const [user, profile] = await Promise.all([
      ctx.db.get("users", userId),
      ctx.db.query("userProfiles").withIndex("by_user", (q) => q.eq("userId", userId)).unique(),
    ]);
    if (user === null) return null;
    return {
      displayName: profile?.displayName ?? user.name ?? "",
      email: user.email ?? "",
      phone: profile?.phone ?? "",
      photoUrl: profile?.photoId ? await ctx.storage.getUrl(profile.photoId) : profile?.photoRemoved ? null : user.image ?? null,
    };
  },
});

export const generateProfilePhotoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveProfile = mutation({
  args: {
    displayName: v.string(),
    phone: v.string(),
    photoId: v.optional(v.id("_storage")),
    removePhoto: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");
    const displayName = args.displayName.trim();
    const phone = args.phone.trim();
    if (displayName.length < 1 || displayName.length > 80) throw new Error("Name must be between 1 and 80 characters.");
    if (phone.length > 32) throw new Error("Phone number must be 32 characters or fewer.");

    if (args.photoId) {
      const metadata = await ctx.db.system.get("_storage", args.photoId);
      const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
      if (!metadata || !metadata.contentType || !allowedTypes.includes(metadata.contentType) || metadata.size > 5 * 1024 * 1024) {
        throw new Error("Choose a JPEG, PNG, or WebP image under 5 MB.");
      }
    }

    const existing = await ctx.db.query("userProfiles").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    const photoId = args.removePhoto ? undefined : args.photoId ?? existing?.photoId;
    const profileFields = {
      userId,
      displayName,
      phone,
      photoId,
      photoRemoved: args.removePhoto ?? false,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, profileFields);
    else await ctx.db.insert("userProfiles", profileFields);

    if (existing?.photoId && existing.photoId !== photoId) await ctx.storage.delete(existing.photoId);
    return null;
  },
});
