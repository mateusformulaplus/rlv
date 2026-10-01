import axios from "axios"
import { randomUUID } from "crypto"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { getPrismaClient } from "../lib/prisma.js"
import { normalizeCalculationShipment } from "./shipping.service.js"

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
        // O ambiente de producao pode fornecer as variaveis diretamente.
    }
    return values
}

const envValues = readEnvValues()

function getValue(name) {
    return process.env[name] || envValues[name] || ""
}

// ---------------------------------------------------------------------------
// Exports de configuracao
// ---------------------------------------------------------------------------

export function getMelhorEnvioBaseUrl() {
    return getValue("MELHOR_ENVIO_BASE_URL") || "https://sandbox.melhorenvio.com.br"
}

export function getMelhorEnvioRedirectUri() {
    return getValue("MELHOR_ENVIO_REDIRECT_URI")
}

export function getMelhorEnvioOriginPostalCode() {
    return getValue("MELHOR_ENVIO_ORIGIN_POSTAL_CODE")
}

function ensureClientConfiguration() {
    if (!getValue("MELHOR_ENVIO_CLIENT_ID") || !getValue("MELHOR_ENVIO_CLIENT_SECRET")) {
        throw new Error("Credenciais do Melhor Envio nao configuradas")
    }
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export async function createMelhorEnvioAuthorizationUrl() {
    ensureClientConfiguration()

    const state = randomUUID()
    await getPrismaClient().melhorEnvioOAuthState.create({
        data: { state, expiresAt: new Date(Date.now() + 10 * 60 * 1000) }
    })

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

    if (!code) {
        throw new Error("Codigo de autorizacao do Melhor Envio nao fornecido")
    }
    if (!state) {
        throw new Error("State de autorizacao nao fornecido")
    }

    const savedState = await getPrismaClient().melhorEnvioOAuthState.findUnique({ where: { state } })
    if (!savedState || savedState.expiresAt <= new Date()) {
        throw new Error("State de autorizacao invalido ou expirado. Clique em 'Autorizar Melhor Envio' novamente.")
    }
    await getPrismaClient().melhorEnvioOAuthState.delete({ where: { state } })

    const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: getValue("MELHOR_ENVIO_CLIENT_ID"),
        client_secret: getValue("MELHOR_ENVIO_CLIENT_SECRET"),
        redirect_uri: getMelhorEnvioRedirectUri(),
        code
    })

    try {
        const response = await axios.post(
            `${getMelhorEnvioBaseUrl()}/oauth/token`,
            body.toString(),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        )

        const accessToken = response.data?.access_token || ""
        if (!accessToken) {
            throw new Error("O Melhor Envio nao retornou um token de acesso")
        }

        const expiresAt = response.data?.expires_in
            ? new Date(Date.now() + Number(response.data.expires_in) * 1000)
            : null
        await getPrismaClient().melhorEnvioCredential.upsert({
            where: { id: "melhor-envio" },
            create: { id: "melhor-envio", accessToken, expiresAt },
            update: { accessToken, expiresAt }
        })

        return { expiresIn: response.data?.expires_in || null }
    } catch (error) {
        const apiError = error?.response?.data
        console.error("[Melhor Envio] Erro ao trocar codigo:", JSON.stringify(apiError ?? error.message))
        const detail = apiError
            ? (apiError.message || apiError.error_description || apiError.error || JSON.stringify(apiError))
            : error.message
        throw new Error(`Falha na autorizacao do Melhor Envio: ${detail}`)
    }
}

// ---------------------------------------------------------------------------
// Calculo de frete
// ---------------------------------------------------------------------------

export async function calculateMelhorEnvioShipping(shipment) {
    const normalizedShipment = normalizeCalculationShipment(shipment)
    const token = await getAccessToken()

    const shipmentWithOrigin = {
        ...normalizedShipment,
        from: normalizedShipment.from?.postal_code
            ? normalizedShipment.from
            : { postal_code: getMelhorEnvioOriginPostalCode() }
    }

    if (!shipmentWithOrigin.from.postal_code) {
        throw new Error("CEP de origem do Melhor Envio nao configurado")
    }

    const response = await axios.post(
        `${getMelhorEnvioBaseUrl()}/api/v2/me/shipment/calculate`,
        shipmentWithOrigin,
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

async function getAccessToken() {
    const credential = await getPrismaClient().melhorEnvioCredential.findUnique({ where: { id: "melhor-envio" } })
    const token = credential?.expiresAt && credential.expiresAt <= new Date()
        ? ""
        : credential?.accessToken || ""
    if (token) return token

    const configuredToken = getValue("MELHOR_ENVIO_ACCESS_TOKEN")
    if (configuredToken) return configuredToken

    throw new Error("Autorize o Melhor Envio antes de calcular o frete")
}


async function melhorEnvioRequest(method, url, data, config = {}) {
    const token = await getAccessToken()
    return axios({
        method,
        url: `${getMelhorEnvioBaseUrl()}${url}`,
        data,
        ...config,
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...(config.headers || {})
        }
    })
}

// ---------------------------------------------------------------------------
// Remessa / Etiqueta / Pedido
// ---------------------------------------------------------------------------

export async function createMelhorEnvioShipment(shipping) {
    if (!shipping?.service || !shipping?.to?.postal_code || !shipping?.to?.address || !shipping?.to?.number) {
        throw new Error("Dados de entrega insuficientes para criar a remessa")
    }

    const response = await melhorEnvioRequest("post", "/api/v2/me/cart", {
        service: shipping.service,
        agency: shipping.agency || null,
        from: shipping.from?.postal_code
            ? shipping.from
            : { postal_code: getMelhorEnvioOriginPostalCode() },
        to: shipping.to,
        products: shipping.products,
        volumes: shipping.volumes,
        options: shipping.options || {
            insurance_value: shipping.insuranceValue || 0,
            receipt: false,
            own_hand: false,
            reverse: false,
            non_commercial: true
        }
    })
    return response.data
}

export async function buyMelhorEnvioShipment(shipmentId) {
    const response = await melhorEnvioRequest("post", "/api/v2/me/checkout", { orders: [shipmentId] })
    return response.data
}

export async function getMelhorEnvioShipmentLabel(shipmentId) {
    const response = await melhorEnvioRequest("get", "/api/v2/me/shipment/print", null, {
        params: { orders: [shipmentId] },
        responseType: "arraybuffer"
    })

    const contentType = response.headers["content-type"] || "application/pdf"
    const labelBase64 = Buffer.from(response.data).toString("base64")
    return {
        contentType,
        data: labelBase64,
        url: null
    }
}

export async function getMelhorEnvioOrder(shipmentId) {
    const response = await melhorEnvioRequest("get", `/api/v2/me/orders/${shipmentId}`)
    return response.data
}