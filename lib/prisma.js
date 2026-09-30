import { PrismaClient } from "@prisma/client"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, "../config/.env")

function loadDatabaseUrls() {
    try {
        const fileContent = readFileSync(envPath, "utf8")
        for (const line of fileContent.split(/\r?\n/)) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith("#")) continue

            const separatorIndex = trimmed.indexOf("=")
            if (separatorIndex < 0) continue

            const key = trimmed.slice(0, separatorIndex).trim()
            if (!['DATABASE_URL', 'DIRECT_URL'].includes(key) || process.env[key]) continue

            const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "")
            process.env[key] = value
        }
    } catch (_error) {
        // Production credentials are provided through the service environment.
    }
}

loadDatabaseUrls()

let prismaClient

export function getPrismaClient() {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL não configurada para o Prisma")
    }

    prismaClient ||= new PrismaClient()
    return prismaClient
}