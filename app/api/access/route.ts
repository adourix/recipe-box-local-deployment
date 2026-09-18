import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const key = process.env.EDIT_KEY;
  return NextResponse.json(
    { authorized: Boolean(key) && req.headers.get("x-edit-key") === key },
    { status: key && req.headers.get("x-edit-key") === key ? 200 : 401,
      headers: { "Cache-Control": "no-store" } }
  );
}
