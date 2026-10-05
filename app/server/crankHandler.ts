import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Connection } from "@solana/web3.js";
import { CONFIG } from "../shared/config";
import { parseSecret } from "./operator";
import { CrankError, remoteSettle } from "./tuktuk";

/** TukTuk remote-transaction endpoint: crank turners POST { task, task_queued_at, task_queue } after an event's deadline. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.CLEARA_OPERATOR_SECRET) return res.status(503).json({ error: "The demo operator is not configured on this deployment." });
  let body: { task?: unknown; task_queued_at?: unknown; task_queue?: unknown };
  try {
    body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) ?? {};
  } catch {
    return res.status(400).json({ error: "Send a JSON request body." });
  }
  const { task, task_queued_at, task_queue } = body;
  if (typeof task !== "string" || typeof task_queued_at !== "string" || typeof task_queue !== "string") return res.status(400).json({ error: "Missing task fields." });
  try {
    const conn = new Connection(process.env.RPC_URL ?? CONFIG.rpc, "confirmed");
    return res.json(await remoteSettle(conn, parseSecret(process.env.CLEARA_OPERATOR_SECRET), { task, taskQueuedAt: task_queued_at, taskQueue: task_queue }));
  } catch (e) {
    if (e instanceof CrankError) return res.status(400).json({ error: e.message });
    return res.status(502).json({ error: `Devnet request failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` });
  }
}
