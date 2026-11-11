import { NextResponse, type NextRequest } from "next/server";
import {
  editorAuthorized,
  editorChallenge,
  publicRoute,
  sameOriginMutation,
} from "./lib/access/editor";
export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (publicRoute(path) && ["GET", "HEAD"].includes(request.method)) return NextResponse.next();
  if (!editorAuthorized(request)) return editorChallenge();
  if (!sameOriginMutation(request)) return new Response("不允许跨站修改工作区", { status: 403 });
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
