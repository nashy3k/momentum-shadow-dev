export { auth as middleware } from "@/auth"

export const config = {
    // Protect all routes except auth-related ones
    matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
