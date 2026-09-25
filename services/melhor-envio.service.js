import axios from "axios"
import { randomUUID } from "crypto"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, "../config/.env")
const authorizationStates = new Set()
let accessToken = ""

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
        // O ambiente de produção pode fornecer as variáveis diretamente.
    }

    return values
}

const envValues = readEnvValues()

function getValue(name) {
    return process.env[name] || envValues[name] || ""
}

export function getMelhorEnvioBaseUrl() {
    return getValue("MELHOR_ENVIO_BASE_URL") || "https://sandbox.melhorenvio.com.br"
}

export function getMelhorEnvioRedirectUri() {
    return getValue("MELHOR_ENVIO_REDIRECT_URI")
}

function ensureClientConfiguration() {
    if (!getValue("MELHOR_ENVIO_CLIENT_ID") || !getValue("MELHOR_ENVIO_CLIENT_SECRET")) {
        throw new Error("Credenciais do Melhor Envio não configuradas")
    }
}

export function createMelhorEnvioAuthorizationUrl() {
    ensureClientConfiguration()

    const state = randomUUID()
    authorizationStates.add(state)

    const params = new URLSearchParams({
        client_id: getValue("MELHOR_ENVIO_CLIENT_ID"),
        redirect_uri: getMelhorEnvioRedirectUri(),
        response_type: "code",
        state
    })

    return `${getMelhorEnvioBaseUrl()}/oauth/authorize?${params.toString()}`
}

export async function exchangeMelhorEnvioCode(code, state) {
    ensureClientConfiguration()

    if (!code || !state || !authorizationStates.has(state)) {
        throw new Error("Código de autorização do Melhor Envio inválido")
    }

    authorizationStates.delete(state)

    const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: getValue("MELHOR_ENVIO_CLIENT_ID"),
        client_secret: getValue("MELHOR_ENVIO_CLIENT_SECRET"),
        redirect_uri: getMelhorEnvioRedirectUri(),
        code
    })

    const response = await axios.post(`${getMelhorEnvioBaseUrl()}/oauth/token`, body.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
    })

    accessToken = response.data?.access_token || ""
    if (!accessToken) {
        throw new Error("O Melhor Envio não retornou um token de acesso")
    }

    return { expiresIn: response.data?.expires_in || null }
}

export async function calculateMelhorEnvioShipping(shipment) {
    const token = getValue("MELHOR_ENVIO_ACCESS_TOKEN") || accessToken
    if (!token) {
        throw new Error("Autorize o Melhor Envio antes de calcular o frete")
    }

    const response = await axios.post(
        `${getMelhorEnvioBaseUrl()}/api/v2/me/shipment/calculate`,
        shipment,
        {
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        }
    )

    return response.data
}