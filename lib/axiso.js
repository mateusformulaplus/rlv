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

function getPagBankEnvironment() {
    const environment = (process.env.PAGBANK_ENV || envValues.PAGBANK_ENV || "production").toLowerCase()
    return environment === "sandbox" ? "SANDBOX" : "PRODUCTION"
}

function getPagBankEnvironmentValue(name) {
    const environment = getPagBankEnvironment()
    return process.env[`PAGBANK_${name}_${environment}`]
        || envValues[`PAGBANK_${name}_${environment}`]
}

export function getPagBankToken() {
    return getPagBankEnvironmentValue("TOKEN")
}

export function getPagBankBaseUrl() {
    return getPagBankEnvironmentValue("BASE_URL")
}

export function getPagBankPublicKey() {
    return getPagBankEnvironmentValue("PUBLIC_KEY")
}

export const apiPagBank = axios.create({
    headers: {
        "Content-Type": "application/json"
    }
})

// Injeta o token e a baseURL dinamicamente a cada requisição,
// garantindo que as credenciais sejam lidas após o .env estar disponível.
apiPagBank.interceptors.request.use((config) => {
    const token = getPagBankToken()
    const baseUrl = getPagBankBaseUrl()

    if (token) {
        config.headers["Authorization"] = `Bearer ${token}`
    }
    if (baseUrl && !config.baseURL) {
        config.baseURL = baseUrl
    } else if (baseUrl) {
        config.baseURL = baseUrl
    }

    return config
})

// // Interceptadores para logar o Request e Response no terminal (Homologação PagBank)
// apiPagBank.interceptors.request.use(request => {
//     console.log("=== PAGBANK REQUEST ===")
//     console.log("URL:", (request.baseURL || '') + (request.url || ''))
//     console.log("Method:", request.method?.toUpperCase())
//     // console.log("Headers:", JSON.stringify(request.headers, null, 2))
//     console.log("Body Payload:", JSON.stringify(request.data, null, 2))
//     console.log("=======================")
//     return request
// })

// apiPagBank.interceptors.response.use(response => {
//     console.log("=== PAGBANK RESPONSE ===")
//     console.log("Status:", response.status)
//     console.log("Body Payload:", JSON.stringify(response.data, null, 2))
//     console.log("========================")
//     return response
// }, error => {
//     console.log("=== PAGBANK ERROR RESPONSE ===")
//     if (error.response) {
//         console.log("Status:", error.response.status)
//         console.log("Body Payload:", JSON.stringify(error.response.data, null, 2))
//     } else {
//         console.log("Error:", error.message)
//     }
//     console.log("==============================")
//     return Promise.reject(error)
// })