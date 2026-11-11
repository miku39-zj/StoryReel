import { listCharacters, saveCharacter } from "@/lib/server/characters";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(listCharacters());
}
export async function POST(request: Request) {
  try {
    return Response.json(saveCharacter(await request.json()), { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "角色保存失败" },
      { status: 400 },
    );
  }
}
