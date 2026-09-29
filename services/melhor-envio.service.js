import axios from "axios"
import { randomUUID } from "crypto"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, "../config/.env")
const dataDirectory = process.env.DATA_DIRECTORY
    ? path.resolve(process.env.DATA_DIRECTORY)
    : path.resolve(__dirname, "../data")
const tokenPath = path.join(dataDirectory, "melhor-envio-token.json")
const statesPath = path.join(dataDirectory, "melhor-envio-states.json")

// Cache em memoria dos states OAuth (tambem persistido em disco)
const authorizationStates = new Set()
let accessToken = ""

// ---------------------------------------------------------------------------
// Helpers de leitura
// ---------------------------------------------------------------------------

function readStoredAccessToken() {
    try {
        const storedToken = JSON.parse(readFileSync(tokenPath, "utf8"))
        if (storedToken.expiresAt && storedToken.expiresAt <= Date.now()) return ""
        return storedToken.accessToken || ""
    } catch (_error) {
        return ""
    }
}

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
// Persistencia do state OAuth (sobrevive a restarts do servidor no Render)
// ---------------------------------------------------------------------------

function loadPersistedStates() {
    try {
        const data = JSON.parse(readFileSync(statesPath, "utf8"))
        const now = Date.now()
        const valid = (data.states || []).filter(s => s.expiresAt > now)
        valid.forEach(s => authorizationStates.add(s.value))
    } catch (_) { /* arquivo ainda nao existe */ }
}

function persistState(state) {
    try {
        mkdirSync(path.dirname(statesPath), { recursive: true })
        let existing = []
        try {
            const data = JSON.parse(readFileSync(statesPath, "utf8"))
            existing = (data.states || []).filter(s => s.expiresAt > Date.now())
        } catch (_) { }
        existing.push({ value: state, expiresAt: Date.now() + 10 * 60 * 1000 })
        writeFileSync(statesPath, JSON.stringify({ states: existing }), "utf8")
    } catch (_) { }
}

// Carrega states persistidos ao iniciar o modulo
loadPersistedStates()

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function createMelhorEnvioAuthorizationUrl() {
    ensureClientConfiguration()

    const state = randomUUID()
    authorizationStates.add(state)
    persistState(state)

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

    // Recarrega states do disco (caso o servidor tenha reiniciado entre a
    // geracao da URL de autorizacao e o retorno do callback)
    loadPersistedStates()

    if (!code) {
        throw new Error("Codigo de autorizacao do Melhor Envio nao fornecido")
    }

    // Valida o state somente se foi fornecido E temos states registrados.
    // Isso evita rejeitar o callback quando o servidor reiniciou e nao ha
    // arquivo de states ainda.
    if (state && authorizationStates.size > 0 && !authorizationStates.has(state)) {
        throw new Error("State de autorizacao invalido ou expirado. Clique em 'Autorizar Melhor Envio' novamente.")
    }

    if (state) authorizationStates.delete(state)

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

        accessToken = response.data?.access_token || ""
        if (!accessToken) {
            throw new Error("O Melhor Envio nao retornou um token de acesso")
        }

        mkdirSync(path.dirname(tokenPath), { recursive: true })
        writeFileSync(tokenPath, JSON.stringify({
            accessToken,
            expiresAt: response.data?.expires_in
                ? Date.now() + Number(response.data.expires_in) * 1000
                : null
        }), "utf8")

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
    const token = getAccessToken()

    const shipmentWithOrigin = {
        ...shipment,
        from: shipment.from?.postal_code
            ? shipment.from
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

function getAccessToken() {
    const token = getValue("MELHOR_ENVIO_ACCESS_TOKEN") || accessToken || readStoredAccessToken()
    if (!token) throw new Error("Autorize o Melhor Envio antes de calcular o frete")
    return token
}

function melhorEnvioRequest(method, url, data, config = {}) {
    return axios({
        method,
        url: `${getMelhorEnvioBaseUrl()}${url}`,
        data,
        ...config,
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${getAccessToken()}`,
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