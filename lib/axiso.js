import axios from "axios"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, "../config/.env")

function readEnvValues() {
    const values = {}

    try {
        const fileContent = readFileSync(envPath, "utf8")
        for (const line of fileContent.split(/\r?\n/)) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith("#")) continue

            const [rawKey, ...rawValueParts] = trimmed.split("=")
            const key = rawKey.trim()
            const value = rawValueParts.join("=").trim()
            values[key] = value.replace(/^['"]|['"]$/g, "")
        }
    } catch (_error) {
        // Ignora se o arquivo .env ainda não existir no ambiente
    }

    return values
}

const envValues = readEnvValues()

export function getPagBankToken() {
    return process.env.PAGBANK_TOKEN || process.env.TOKEN_PAGBANK || envValues.PAGBANK_TOKEN || envValues.TOKEN_PAGBANK || ""
}

export function getPagBankBaseUrl() {
    return process.env.PAGBANK_BASE_URL || envValues.PAGBANK_BASE_URL || "https://sandbox.api.pagseguro.com"
}

export const apiPagBank = axios.create({
    baseURL: getPagBankBaseUrl(),
    headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getPagBankToken()}`
    }
})