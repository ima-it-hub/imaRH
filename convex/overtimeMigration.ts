import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./lib";

export const cleanLegacyOvertimeBatch = mutation({
  args: {
    token: v.string(),
    overtimeCursor: v.union(v.string(), v.null()),
    overtimeDone: v.boolean(),
    attendanceCursor: v.union(v.string(), v.null()),
    attendanceDone: v.boolean(),
    notificationCursor: v.union(v.string(), v.null()),
    notificationDone: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);

    let overtimeCursor = args.overtimeCursor;
    let overtimeDone = args.overtimeDone;
    let attendanceCursor = args.attendanceCursor;
    let attendanceDone = args.attendanceDone;
    let notificationCursor = args.notificationCursor;
    let notificationDone = args.notificationDone;
    let removedRecords = 0;
    let removedBonuses = 0;
    let updatedAttendances = 0;
    let removedNotifications = 0;

    if (!overtimeDone) {
      const page = await ctx.db
        .query("overtimeRecords")
        .paginate({ numItems: 100, cursor: overtimeCursor });

      for (const record of page.page) {
        if (record.bonusId && (await ctx.db.get(record.bonusId))) {
          await ctx.db.delete(record.bonusId);
          removedBonuses += 1;
        }
        await ctx.db.delete(record._id);
        removedRecords += 1;
      }

      overtimeCursor = page.continueCursor;
      overtimeDone = page.isDone;
    }

    if (!attendanceDone) {
      const page = await ctx.db
        .query("attendances")
        .paginate({ numItems: 100, cursor: attendanceCursor });

      for (const attendance of page.page) {
        if (
          attendance.overtimeMinutes !== undefined ||
          attendance.overtimeAmount !== undefined
        ) {
          await ctx.db.patch(attendance._id, {
            overtimeMinutes: undefined,
            overtimeAmount: undefined,
          });
          updatedAttendances += 1;
        }
      }

      attendanceCursor = page.continueCursor;
      attendanceDone = page.isDone;
    }

    if (!notificationDone) {
      const page = await ctx.db
        .query("notifications")
        .paginate({ numItems: 100, cursor: notificationCursor });

      for (const notification of page.page) {
        if (
          notification.title === "Heures supplémentaires" ||
          notification.title.startsWith("HS ")
        ) {
          await ctx.db.delete(notification._id);
          removedNotifications += 1;
        }
      }

      notificationCursor = page.continueCursor;
      notificationDone = page.isDone;
    }

    return {
      overtimeCursor,
      overtimeDone,
      attendanceCursor,
      attendanceDone,
      notificationCursor,
      notificationDone,
      removedRecords,
      removedBonuses,
      updatedAttendances,
      removedNotifications,
    };
  },
});
