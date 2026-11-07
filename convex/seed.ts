import { mutation } from "./_generated/server";
import { MutationCtx } from "./_generated/server";
import {
  EMPLOYEE_PAGE_KEYS,
  generateUniqueBarcode,
  hashPassword,
  normalizeUsername,
} from "./lib";

async function ensureSettings(ctx: MutationCtx) {
  const settings = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", "default"))
    .unique();
  if (!settings) {
    await ctx.db.insert("settings", {
      key: "default",
      workStartHour: 8,
      workStartMinute: 30,
      workEndHour: 17,
      workEndMinute: 0,
      lateToleranceMinutes: 10,
      requiredWorkMinutes: 480,
      thursdayRequiredWorkMinutes: 240,
      thursdayWorkEndHour: 12,
      thursdayWorkEndMinute: 30,
      workingDaysPerMonth: 26,
    });
  }
}

export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    await ensureSettings(ctx);

    const users = await ctx.db.query("users").collect();

    for (const user of users) {
      const patch: Record<string, unknown> = {};
      const hasNewKey = user.allowedPages.some((p) =>
        (EMPLOYEE_PAGE_KEYS as readonly string[]).includes(p)
      );
      if (!hasNewKey) {
        patch.allowedPages = [...EMPLOYEE_PAGE_KEYS];
        patch.firstName = user.firstName ?? user.name.split(" ")[0] ?? user.name;
        patch.lastName =
          user.lastName ?? user.name.split(" ").slice(1).join(" ") ?? "";
        patch.annualLeaveBalance = user.annualLeaveBalance ?? 18;
        patch.annualLeaveQuota = user.annualLeaveQuota ?? 30;
        patch.baseSalary =
          user.baseSalary ?? (user.role === "employee" ? 85000 : 0);
        patch.department =
          user.department ?? (user.role === "admin" ? "RH" : "");
      }
      if (user.role === "employee" && !user.barcode) {
        patch.barcode = await generateUniqueBarcode(ctx);
      }
      if (!user.username) {
        const fromEmail = user.email.split("@")[0] ?? user.name;
        patch.username = normalizeUsername(fromEmail);
      }
      if (user.baseBonus === undefined && user.role === "employee") {
        patch.baseBonus = 10000;
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(user._id, patch);
      }
    }

    if (users.length > 0) {
      return { seeded: false, message: "Des utilisateurs existent déjà" };
    }

    const adminHash = await hashPassword("admin123");
    const empHash = await hashPassword("emp123");
    const mgrHash = await hashPassword("mgr123");

    const mainWorkplaceId = await ctx.db.insert("workplaces", {
      name: "Siège Alger",
      description: "Site principal",
      createdAt: Date.now(),
    });

    const opsDeptId = await ctx.db.insert("departments", {
      name: "Opérations",
      description: "Équipe opérationnelle terrain",
      workplaceId: mainWorkplaceId,
      createdAt: Date.now(),
    });
    const rhDeptId = await ctx.db.insert("departments", {
      name: "RH",
      description: "Ressources humaines",
      workplaceId: mainWorkplaceId,
      createdAt: Date.now(),
    });

    const opsConditions = [
      "Ponctualité & assiduité",
      "Qualité du travail",
      "Esprit d'équipe",
      "Respect des procédures",
      "Productivité",
    ];
    for (let i = 0; i < opsConditions.length; i++) {
      await ctx.db.insert("evaluationConditions", {
        departmentId: opsDeptId,
        label: opsConditions[i]!,
        description: "",
        sortOrder: i,
        isActive: true,
      });
    }

    const adminId = await ctx.db.insert("users", {
      name: "Admin GIALCO",
      firstName: "Admin",
      lastName: "GIALCO",
      username: "admin",
      email: "admin@gialco.dz",
      passwordHash: adminHash,
      role: "admin",
      allowedPages: [...EMPLOYEE_PAGE_KEYS],
      isActive: true,
      phone: "0555000001",
      department: "RH",
      departmentId: rhDeptId,
      workplace: "Siège Alger",
      workplaceId: mainWorkplaceId,
      hireDate: Date.now(),
      annualLeaveBalance: 30,
      annualLeaveQuota: 30,
      baseSalary: 0,
      baseBonus: 0,
    });

    const mgrBarcode = await generateUniqueBarcode(ctx);
    const managerId = await ctx.db.insert("users", {
      name: "Manager Démo",
      firstName: "Manager",
      lastName: "Démo",
      username: "manager",
      email: "manager@gialco.dz",
      passwordHash: mgrHash,
      role: "employee",
      allowedPages: [...EMPLOYEE_PAGE_KEYS],
      isActive: true,
      phone: "0555000003",
      department: "Opérations",
      departmentId: opsDeptId,
      workplace: "Siège Alger",
      workplaceId: mainWorkplaceId,
      managerId: adminId,
      hireDate: Date.now(),
      annualLeaveBalance: 22,
      annualLeaveQuota: 30,
      baseSalary: 120000,
      baseBonus: 15000,
      barcode: mgrBarcode,
    });

    const empBarcode = await generateUniqueBarcode(ctx);
    const empId = await ctx.db.insert("users", {
      name: "Employé Démo",
      firstName: "Employé",
      lastName: "Démo",
      username: "employee",
      email: "employee@gialco.dz",
      passwordHash: empHash,
      role: "employee",
      allowedPages: [...EMPLOYEE_PAGE_KEYS],
      isActive: true,
      phone: "0555000002",
      department: "Opérations",
      departmentId: opsDeptId,
      workplace: "Siège Alger",
      workplaceId: mainWorkplaceId,
      managerId: managerId,
      hireDate: Date.now(),
      annualLeaveBalance: 18,
      annualLeaveQuota: 30,
      baseSalary: 85000,
      baseBonus: 10000,
      barcode: empBarcode,
    });

    const now = new Date();
    await ctx.db.insert("salaries", {
      employeeId: empId,
      baseSalary: 85000,
      lateDeductions: 0,
      netPay: 85000,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("salaries", {
      employeeId: managerId,
      baseSalary: 120000,
      lateDeductions: 0,
      netPay: 120000,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      updatedAt: Date.now(),
    });

    return {
      seeded: true,
      message: "Comptes démo créés",
      accounts: [
        { username: "admin", password: "admin123", role: "admin" },
        { username: "manager", password: "mgr123", role: "employee/manager" },
        { username: "employee", password: "emp123", role: "employee" },
      ],
    };
  },
});
