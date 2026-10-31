import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval(
	"Transaction classification recovery",
	{ minutes: 5 },
	internal.classification.poll,
	{},
);
crons.interval(
	"Bank import retry and freshness",
	{ hours: 6 },
	internal.bank.poll,
	{},
);
export default crons;
