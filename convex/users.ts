import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
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

export const registerProfilePhotoUpload = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!metadata || !metadata.contentType || !allowedTypes.includes(metadata.contentType) || metadata.size > 5 * 1024 * 1024) {
      throw new Error("Choose a JPEG, PNG, or WebP image under 5 MB.");
    }
    const existing = await ctx.db.query("profilePhotoUploads").withIndex("by_storage", (q) => q.eq("storageId", args.storageId)).unique();
    if (existing) {
      if (existing.userId !== userId) throw new Error("This photo upload is not available to your account.");
      return existing._id;
    }
    const uploadId = await ctx.db.insert("profilePhotoUploads", { userId, storageId: args.storageId, createdAt: Date.now() });
    await ctx.scheduler.runAfter(24 * 60 * 60 * 1000, internal.users.expireProfilePhotoUpload, { uploadId });
    return uploadId;
  },
});

export const discardProfilePhotoUpload = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");
    const upload = await ctx.db.query("profilePhotoUploads").withIndex("by_storage", (q) => q.eq("storageId", args.storageId)).unique();
    if (!upload) return null;
    if (upload.userId !== userId) throw new Error("This photo upload is not available to your account.");
    await ctx.storage.delete(upload.storageId);
    await ctx.db.delete(upload._id);
    return null;
  },
});

export const expireProfilePhotoUpload = internalMutation({
  args: { uploadId: v.id("profilePhotoUploads") },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload) return null;
    await ctx.storage.delete(upload.storageId);
    await ctx.db.delete(upload._id);
    return null;
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
    if (args.removePhoto && args.photoId) throw new Error("Choose either a new photo or remove the current photo.");
    let pendingUpload: Doc<"profilePhotoUploads"> | null = null;
    if (args.photoId && args.photoId !== existing?.photoId) {
      pendingUpload = await ctx.db.query("profilePhotoUploads").withIndex("by_storage", (q) => q.eq("storageId", args.photoId!)).unique();
      if (!pendingUpload || pendingUpload.userId !== userId) throw new Error("Upload this photo again before saving your profile.");
    }
    const photoId = args.removePhoto ? undefined : args.photoId ?? existing?.photoId;
    const profileFields = {
      userId,
      displayName,
      phone,
      photoId,
      photoRemoved: args.removePhoto ? true : args.photoId ? false : existing?.photoRemoved ?? false,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, profileFields);
    else await ctx.db.insert("userProfiles", profileFields);

    if (existing?.photoId && existing.photoId !== photoId) await ctx.storage.delete(existing.photoId);
    if (pendingUpload) await ctx.db.delete(pendingUpload._id);
    return null;
  },
});
