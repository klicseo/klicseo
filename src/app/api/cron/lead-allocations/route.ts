import { NextResponse } from "next/server";
import { processScheduledJobs } from "@/lib/lead-routing";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    // Verify optional CRON_SECRET if configured in Vercel environment variables
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const res = await processScheduledJobs();
    return NextResponse.json({
      ok: true,
      executedCount: res.executedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    console.error("Cron lead-allocations error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cron execution failed" },
      { status: 500 },
    );
  }
}
