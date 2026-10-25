import "server-only";
import { NextResponse } from "next/server";
import { env } from "./env";

/** Redirect within the app, always to our own origin. */
export const appRedirect = (path: string) => NextResponse.redirect(new URL(path, env().APP_URL));
