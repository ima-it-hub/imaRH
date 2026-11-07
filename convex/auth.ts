import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  createToken,
  getUserBySession,
  hashPassword,
  normalizeUsername,
  publicUser,
} from "./lib";

const SESSION_DAYS = 7;

export const login = mutation({
  args: {
    username: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const username = normalizeUsername(args.username);
    if (!username) {
      throw new Error("Nom d'utilisateur ou mot de passe invalide");
    }

    let user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();

    // Fallback for older accounts that only had email
    if (!user) {
      user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", username))
        .unique();
    }

    if (!user || !user.isActive) {
      throw new Error("Nom d'utilisateur ou mot de passe invalide");
    }

    const passwordHash = await hashPassword(args.password);
    if (passwordHash !== user.passwordHash) {
      throw new Error("Nom d'utilisateur ou mot de passe invalide");
    }

    const token = createToken();
    const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;

    await ctx.db.insert("sessions", {
      userId: user._id,
      token,
      expiresAt,
    });

    return {
      token,
      user: publicUser(user),
    };
  },
});

export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (session) {
      await ctx.db.delete(session._id);
    }

    return { ok: true };
  },
});

export const me = query({
  args: { token: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const result = await getUserBySession(ctx, args.token);
    if (!result) return null;
    return publicUser(result.user);
  },
});

export const updateProfile = mutation({
  args: {
    token: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    const result = await getUserBySession(ctx, args.token);
    if (!result) throw new Error("Session expirée");

    const firstName = args.firstName.trim();
    const lastName = args.lastName.trim();
    const name = `${firstName} ${lastName}`.trim() || result.user.name;

    await ctx.db.patch(result.user._id, {
      firstName,
      lastName,
      name,
      phone: args.phone.trim(),
    });

    const updated = await ctx.db.get(result.user._id);
    return publicUser(updated!);
  },
});

export const changePassword = mutation({
  args: {
    token: v.string(),
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const result = await getUserBySession(ctx, args.token);
    if (!result) throw new Error("Session expirée");

    const currentHash = await hashPassword(args.currentPassword);
    if (currentHash !== result.user.passwordHash) {
      throw new Error("Mot de passe actuel incorrect");
    }
    if (args.newPassword.length < 4) {
      throw new Error("Le nouveau mot de passe doit contenir au moins 4 caractères");
    }

    await ctx.db.patch(result.user._id, {
      passwordHash: await hashPassword(args.newPassword),
    });

    return { ok: true };
  },
});
