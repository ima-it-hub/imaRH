import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.cron(
  "annual leave year-end settlement",
  "0 23 31 12 *",
  internal.annualLeave.settleYearEnd,
  {}
);

export default crons;
