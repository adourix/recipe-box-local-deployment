import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!process.env.EDIT_KEY || req.headers.get("x-edit-key") !== process.env.EDIT_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const data = [];
  const sb = supabaseAdmin();
  for (let offset = 0; ; offset += 500) {
    const {data: batch, error} = await sb.from("recipes").select("*")
      .order("created_at", {ascending: false}).order("id", {ascending: false}).range(offset, offset + 499);
    if (error) return NextResponse.json({error: "export failed"}, {status: 500});
    data.push(...batch);
    if (batch.length < 500) break;
  }
  return NextResponse.json(data, {headers: {"Cache-Control": "no-store"}});
}
