import { projectHistory, restoreProjectRevision, ProjectConflict } from "@/lib/server/projects";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json({ versions: projectHistory((await params).id) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { revision, expectedRevision } = z
      .object({
        revision: z.number().int().nonnegative(),
        expectedRevision: z.number().int().nonnegative(),
      })
      .parse(await req.json());
    return Response.json(
      await restoreProjectRevision((await params).id, revision, expectedRevision),
    );
  } catch (e) {
    return Response.json(
      { error: (e as Error).message },
      { status: e instanceof ProjectConflict ? 409 : 400 },
    );
  }
}
