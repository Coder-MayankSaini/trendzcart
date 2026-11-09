import path from "path";
import fs from "fs";
import { pathToFileURL, fileURLToPath } from "url";

export async function resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") {
        return nextResolve("next/server.js", context);
    }

    if (specifier === "server-only") {
        return nextResolve(pathToFileURL(path.resolve(process.cwd(), "tests", "mocks", "server-only.js")).href, context);
    }

    if (specifier.startsWith("@/")) {
        const subpath = specifier.slice(2);
        const resolvedPath = path.resolve(process.cwd(), "src", subpath);
        const candidates = [
            resolvedPath,
            resolvedPath + ".ts",
            resolvedPath + ".tsx",
            resolvedPath + ".js",
            path.join(resolvedPath, "index.ts"),
            path.join(resolvedPath, "index.js"),
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return nextResolve(pathToFileURL(candidate).href, context);
            }
        }
    }

    if (specifier.startsWith("./") || specifier.startsWith("../")) {
        let parentDir = process.cwd();
        if (context.parentURL) {
            try {
                parentDir = path.dirname(fileURLToPath(context.parentURL));
            } catch {}
        }
        const resolvedPath = path.resolve(parentDir, specifier);
        const candidates = [
            resolvedPath + ".ts",
            resolvedPath + ".tsx",
            resolvedPath + ".js",
            path.join(resolvedPath, "index.ts"),
            path.join(resolvedPath, "index.js"),
        ];
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return nextResolve(pathToFileURL(candidate).href, context);
            }
        }
    }

    return nextResolve(specifier, context);
}
