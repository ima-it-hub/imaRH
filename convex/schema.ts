import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    username: v.optional(v.string()),
    email: v.string(),
    passwordHash: v.string(),
    role: v.union(v.literal("admin"), v.literal("employee")),
    allowedPages: v.array(v.string()),
    isActive: v.boolean(),
    phone: v.optional(v.string()),
    /** Display name kept in sync with departments.name */
    department: v.optional(v.string()),
    departmentId: v.optional(v.id("departments")),
    /** Display name kept in sync with workplaces.name */
    workplace: v.optional(v.string()),
    workplaceId: v.optional(v.id("workplaces")),
    associatedAgentCode: v.optional(v.string()),
    silwanCategoryCode: v.optional(v.string()),
    managerId: v.optional(v.id("users")),
    /** Legacy prime mode; new prime calculations use baseBonus for everyone. */
    bonusType: v.optional(
      v.union(v.literal("FIXED"), v.literal("PERCENTAGE"))
    ),
    /** Prime de base (DZD) for the unified prime calculation */
    baseBonus: v.optional(v.number()),
    /** Legacy percentage-based prime value */
    bonusPercent: v.optional(v.number()),
    hireDate: v.optional(v.number()),
    resignedAt: v.optional(v.number()),
    annualLeaveBalance: v.optional(v.number()),
    annualLeaveBalanceYear: v.optional(v.number()),
    annualLeaveQuota: v.optional(v.number()),
    baseSalary: v.optional(v.number()),
    barcode: v.optional(v.string()),
    /** Numeric User ID enrolled on the ZKTeco K50 Pro (e.g. "1", "12") */
    zktecoUserId: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    .index("by_username", ["username"])
    .index("by_barcode", ["barcode"])
    .index("by_zkteco_user_id", ["zktecoUserId"])
    .index("by_manager", ["managerId"])
    .index("by_department", ["departmentId"])
    .index("by_workplace", ["workplaceId"]),

  sessions: defineTable({
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_user", ["userId"]),

  settings: defineTable({
    key: v.string(),
    workStartHour: v.number(),
    workStartMinute: v.number(),
    lateToleranceMinutes: v.number(),
    /** End of workday — time after this is not counted (Algiers) */
    workEndHour: v.optional(v.number()),
    workEndMinute: v.optional(v.number()),
    /** Required work duration per day in minutes (e.g. 480 = 8h) */
    requiredWorkMinutes: v.optional(v.number()),
    /** Thursday half-day required duration in minutes (admin-defined) */
    thursdayRequiredWorkMinutes: v.optional(v.number()),
    /** Thursday leaving time */
    thursdayWorkEndHour: v.optional(v.number()),
    thursdayWorkEndMinute: v.optional(v.number()),
    /** Used to convert delay minutes into money from monthly salary */
    workingDaysPerMonth: v.optional(v.number()),
    /** Legacy prime weight; retained for stored settings compatibility. */
    primeObjectiveWeightPercent: v.optional(v.number()),
    /** Legacy prime weight retained for stored settings compatibility. */
    primeRecoveryWeightPercent: v.optional(v.number()),
    /** Legacy prime weight retained for stored settings compatibility. */
    primeEvaluationWeightPercent: v.optional(v.number()),
  }).index("by_key", ["key"]),

  /** Physical / operational site. Departments are assigned to a workplace. */
  workplaces: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    associatedAgentCode: v.optional(v.string()),
    workStartHour: v.optional(v.number()),
    workStartMinute: v.optional(v.number()),
    workEndHour: v.optional(v.number()),
    workEndMinute: v.optional(v.number()),
    lateToleranceMinutes: v.optional(v.number()),
    breakMinutes: v.optional(v.number()),
    requiredWorkMinutes: v.optional(v.number()),
    thursdayRequiredWorkMinutes: v.optional(v.number()),
    thursdayWorkEndHour: v.optional(v.number()),
    thursdayWorkEndMinute: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_name", ["name"]),

  departments: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    workplaceId: v.optional(v.id("workplaces")),
    evaluationWeightPercent: v.optional(v.number()),
    realisationWeightPercent: v.optional(v.number()),
    companyRealisationWeightPercent: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_workplace", ["workplaceId"]),

  evaluationConditions: defineTable({
    departmentId: v.id("departments"),
    libraryConditionId: v.optional(v.id("evaluationConditionLibrary")),
    label: v.string(),
    description: v.optional(v.string()),
    sortOrder: v.number(),
    isActive: v.boolean(),
    weightPercent: v.optional(v.number()),
  })
    .index("by_department", ["departmentId"])
    .index("by_department_active", ["departmentId", "isActive"]),

  evaluationConditionLibrary: defineTable({
    label: v.string(),
    description: v.optional(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
  }).index("by_label", ["label"]),

  attendances: defineTable({
    employeeId: v.id("users"),
    date: v.string(),
    /** All badge scans of the day (odd=in, even=out) */
    scans: v.optional(v.array(v.number())),
    clockInAt: v.optional(v.number()),
    clockOutAt: v.optional(v.number()),
    workedMinutes: v.optional(v.number()),
    requiredMinutes: v.optional(v.number()),
    /** Minutes beyond required work duration */
    overtimeMinutes: v.optional(v.number()),
    lateMinutes: v.number(),
    morningLateMinutes: v.optional(v.number()),
    breakLateMinutes: v.optional(v.number()),
    missingScans: v.optional(v.number()),
    /** Money deducted from solde for this day's delay */
    delayAmount: v.optional(v.number()),
    /** Raw overtime pay before approvals (salary rate × minutes × 2) */
    overtimeAmount: v.optional(v.number()),
    lateAdjustedByAdmin: v.optional(v.boolean()),
    status: v.union(
      v.literal("present"),
      v.literal("late"),
      v.literal("absent"),
      v.literal("leave"),
      v.literal("working")
    ),
  })
    .index("by_employee_date", ["employeeId", "date"])
    .index("by_date", ["date"])
    .index("by_employee", ["employeeId"]),

  /** Extra hours beyond required day — manager then admin approval → credit solde */
  overtimeRecords: defineTable({
    employeeId: v.id("users"),
    attendanceId: v.optional(v.id("attendances")),
    date: v.string(),
    month: v.number(),
    year: v.number(),
    overtimeMinutes: v.number(),
    /** Doubled rate amount in DZD */
    amount: v.number(),
    status: v.union(
      v.literal("EN_ATTENTE_MANAGER"),
      v.literal("REFUSE_MANAGER"),
      v.literal("EN_ATTENTE_ADMIN"),
      v.literal("APPROUVE"),
      v.literal("REFUSE_ADMIN")
    ),
    managerId: v.optional(v.id("users")),
    managerTreatedAt: v.optional(v.number()),
    managerNote: v.optional(v.string()),
    adminId: v.optional(v.id("users")),
    adminTreatedAt: v.optional(v.number()),
    adminNote: v.optional(v.string()),
    bonusId: v.optional(v.id("bonuses")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee", ["employeeId"])
    .index("by_employee_date", ["employeeId", "date"])
    .index("by_status", ["status"])
    .index("by_period", ["year", "month"])
    .index("by_manager_status", ["managerId", "status"]),

  leaves: defineTable({
    employeeId: v.id("users"),
    companyLeaveName: v.optional(v.string()),
    companyLeaveHalfDay: v.optional(v.boolean()),
    companyLeaveLeavingTime: v.optional(v.string()),
    type: v.union(
      v.literal("annuel"),
      v.literal("maladie"),
      v.literal("sans_solde"),
      v.literal("evenements_familiaux"),
      v.literal("mariage"),
      v.literal("deces"),
      v.literal("examen_formation"),
      v.literal("recuperation"),
      v.literal("autre")
    ),
    startDate: v.string(),
    endDate: v.string(),
    days: v.number(),
    reason: v.string(),
    status: v.union(
      v.literal("EN_ATTENTE"),
      v.literal("APPROUVE"),
      v.literal("REFUSE"),
      v.literal("CLOTURE")
    ),
    adminResponse: v.optional(v.string()),
    /** Legacy leave types use this flag for their historical salary/balance rules. */
    isPaid: v.optional(v.boolean()),
    /** Actual dates entered by admin after return */
    actualStartDate: v.optional(v.string()),
    actualEndDate: v.optional(v.string()),
    /** Only when actual days > requested */
    delayStatus: v.optional(
      v.union(v.literal("ACCEPTABLE"), v.literal("NON_ACCEPTABLE"))
    ),
    /** Days finally charged to annual balance */
    deductedDays: v.optional(v.number()),
    balanceDeducted: v.optional(v.boolean()),
    /** Days charged against salary (unpaid / sans_solde overflow) */
    salaryDeductedDays: v.optional(v.number()),
    salaryDeductionAmount: v.optional(v.number()),
    createdAt: v.number(),
    treatedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
  })
    .index("by_employee", ["employeeId"])
    .index("by_status", ["status"]),

  companyHalfDaySchedules: defineTable({
    name: v.string(),
    date: v.string(),
    leavingTime: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_date", ["date"]),

  salaries: defineTable({
    employeeId: v.id("users"),
    /** Amount credited for this month (may be prorated from hire date) */
    baseSalary: v.number(),
    /** Full contractual monthly salary used for proration */
    contractualSalary: v.optional(v.number()),
    /** Days paid this month / days in calendar month (hire proration) */
    daysWorked: v.optional(v.number()),
    daysInMonth: v.optional(v.number()),
    /** Legacy field; lateness penalties now reduce the employee's available balance. */
    lateDeductions: v.optional(v.number()),
    /** Unpaid leave / sans_solde deductions for the month */
    leaveDeductions: v.optional(v.number()),
    netPay: v.optional(v.number()),
    month: v.number(),
    year: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee", ["employeeId"])
    .index("by_employee_period", ["employeeId", "year", "month"]),

  approvedLateDeductions: defineTable({
    employeeId: v.id("users"),
    month: v.number(),
    year: v.number(),
    amount: v.number(),
    morningLateMinutes: v.optional(v.number()),
    breakLateMinutes: v.optional(v.number()),
    missingScans: v.optional(v.number()),
    approvedBy: v.id("users"),
    approvedAt: v.number(),
  })
    .index("by_employee", ["employeeId"])
    .index("by_employee_period", ["employeeId", "year", "month"])
    .index("by_period", ["year", "month"]),

  bonuses: defineTable({
    employeeId: v.id("users"),
    amount: v.number(),
    title: v.string(),
    reason: v.string(),
    attributedAt: v.number(),
    /** Link to evaluation report when auto-generated */
    reportId: v.optional(v.id("monthlyReports")),
    month: v.optional(v.number()),
    year: v.optional(v.number()),
  })
    .index("by_employee", ["employeeId"])
    .index("by_report", ["reportId"]),

  annualLeaveSettlements: defineTable({
    employeeId: v.id("users"),
    year: v.number(),
    kind: v.union(v.literal("YEAR_END"), v.literal("RESIGNATION")),
    days: v.number(),
    amount: v.number(),
    createdAt: v.number(),
  })
    .index("by_employee", ["employeeId"])
    .index("by_employee_period", ["employeeId", "year"])
    .index("by_employee_year_kind", ["employeeId", "year", "kind"]),

  paymentOrders: defineTable({
    employeeId: v.id("users"),
    /** Salary record that generated this monthly payment order, if applicable */
    salaryId: v.optional(v.id("salaries")),
    type: v.union(
      v.literal("SALAIRE_MENSUEL"),
      v.literal("ACOMPTE"),
      v.literal("PRIME")
    ),
    amount: v.number(),
    status: v.union(
      v.literal("DEMANDE"),
      v.literal("VALIDE"),
      v.literal("A_CONFIRMER"),
      v.literal("PAYE"),
      v.literal("REJETE")
    ),
    note: v.optional(v.string()),
    requestedAt: v.number(),
    treatedAt: v.optional(v.number()),
    disbursedAt: v.optional(v.number()),
    confirmedAt: v.optional(v.number()),
    receiptReference: v.optional(v.string()),
  })
    .index("by_employee", ["employeeId"])
    .index("by_salary", ["salaryId"])
    .index("by_status", ["status"]),

  monthlyReports: defineTable({
    employeeId: v.id("users"),
    adminId: v.id("users"),
    month: v.number(),
    year: v.number(),
    /** @deprecated legacy single report; prefer employeeReport */
    content: v.optional(v.string()),
    adminReport: v.optional(v.string()),
    employeeReport: v.optional(v.string()),
    scores: v.optional(
      v.array(
        v.object({
          conditionId: v.id("evaluationConditions"),
          label: v.string(),
          points: v.number(),
          weightPercent: v.optional(v.number()),
        })
      )
    ),
    percentage: v.optional(v.number()),
    weeklyEvaluationCount: v.optional(v.number()),
    baseBonus: v.optional(v.number()),
    computedBonus: v.optional(v.number()),
    bonusId: v.optional(v.id("bonuses")),
    /** EN_ATTENTE = manager submitted, awaiting admin confirm */
    status: v.optional(
      v.union(v.literal("EN_ATTENTE"), v.literal("CONFIRME"))
    ),
    submittedAt: v.optional(v.number()),
    confirmedAt: v.optional(v.number()),
    confirmedBy: v.optional(v.id("users")),
    publishedAt: v.number(),
  })
    .index("by_employee", ["employeeId"])
    .index("by_employee_period", ["employeeId", "year", "month"])
    .index("by_status", ["status"]),

  weeklyEvaluations: defineTable({
    employeeId: v.id("users"),
    managerId: v.id("users"),
    weekStart: v.string(),
    adminMessage: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("EN_ATTENTE"), v.literal("CONFIRME"))
    ),
    scores: v.array(
      v.object({
        conditionId: v.id("evaluationConditions"),
        label: v.string(),
        points: v.number(),
        weightPercent: v.optional(v.number()),
      })
    ),
    percentage: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    submittedAt: v.optional(v.number()),
    confirmedAt: v.optional(v.number()),
    confirmedBy: v.optional(v.id("users")),
  })
    .index("by_employee_week", ["employeeId", "weekStart"])
    .index("by_week", ["weekStart"])
    .index("by_employee", ["employeeId"]),

  /** Monthly unified base-prime calculation for employees and their managers */
  primeCalculations: defineTable({
    employeeId: v.id("users"),
    month: v.number(),
    year: v.number(),
    objective: v.number(),
    realisation: v.number(),
    recouvrement: v.number(),
    /** Required recovery amount for individually calculated employees */
    recoveryObjective: v.optional(v.number()),
    /** Whether objective / realization were entered specifically for this employee */
    hasOwnMetrics: v.optional(v.boolean()),
    /** Employee whose own metrics are inherited when hasOwnMetrics is false */
    sourceManagerId: v.optional(v.id("users")),
    /** Workplace whose metrics are inherited when hasOwnMetrics is false */
    sourceWorkplaceId: v.optional(v.id("workplaces")),
    /** Version of the prime formula used for this saved calculation */
    calculationVersion: v.optional(v.number()),
    /** Fixed base prime in DZD */
    primeBase: v.number(),
    objectiveRatio: v.number(),
    objectiveAmount: v.number(),
    companyRealisationRatio: v.optional(v.number()),
    companyRealisationAmount: v.optional(v.number()),
    recoveryRatio: v.number(),
    recoveryAmount: v.number(),
    evaluationPercent: v.number(),
    evaluationAmount: v.number(),
    totalAmount: v.number(),
    adminAdjustedAmount: v.optional(v.number()),
    objectiveWeightPercent: v.number(),
    recoveryWeightPercent: v.number(),
    evaluationWeightPercent: v.number(),
    companyRealisationWeightPercent: v.optional(v.number()),
    employeeBonusPercent: v.number(),
    status: v.union(v.literal("BROUILLON"), v.literal("CONFIRME")),
    bonusId: v.optional(v.id("bonuses")),
    createdAt: v.number(),
    updatedAt: v.number(),
    confirmedAt: v.optional(v.number()),
    confirmedBy: v.optional(v.id("users")),
  })
    .index("by_employee", ["employeeId"])
    .index("by_employee_period", ["employeeId", "year", "month"])
    .index("by_period", ["year", "month"])
    .index("by_status", ["status"]),

  workplacePrimeMetrics: defineTable({
    workplaceId: v.id("workplaces"),
    month: v.number(),
    year: v.number(),
    objective: v.number(),
    realisation: v.number(),
    recoveryObjective: v.optional(v.number()),
    recouvrement: v.optional(v.number()),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
  })
    .index("by_period", ["year", "month"])
    .index("by_workplace_period", ["workplaceId", "year", "month"]),

  silwanRealisationSyncs: defineTable({
    ownerType: v.union(v.literal("employee"), v.literal("workplace")),
    employeeId: v.optional(v.id("users")),
    workplaceId: v.optional(v.id("workplaces")),
    associatedAgentCode: v.optional(v.string()),
    sourceType: v.optional(
      v.union(v.literal("associated_agent"), v.literal("central_total"))
    ),
    month: v.number(),
    year: v.number(),
    realisation: v.number(),
    recouvrement: v.optional(v.number()),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
  })
    .index("by_employee_period", ["employeeId", "year", "month"])
    .index("by_workplace_period", ["workplaceId", "year", "month"])
    .index("by_period", ["year", "month"]),

  notifications: defineTable({
    userId: v.id("users"),
    title: v.string(),
    message: v.string(),
    read: v.boolean(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),
});
