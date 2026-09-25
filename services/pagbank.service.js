import { apiPagBank, getPagBankToken } from "../lib/axiso.js"


export function buildCheckoutPayload({
    productName = "RLV Fórmulas",
    amount = 0,
    quantity = 1,
    referenceId,
    customer = {}
} = {}) {

    const numericAmount = Number(amount || 0)
    const amountInCents = Math.round(numericAmount * 100)

    return {
        reference_id: referenceId || `rlv-${Date.now()}`,

        // Permite que o cliente preencha os dados pessoais
        customer_modifiable: true,

        // Produto
        items: [
            {
                name: productName,
                quantity: Number(quantity || 1),
                unit_amount: amountInCents,
                image_url:
                    "https://rlvformulas-arch.github.io/rlv_produtos/logo_micose_one.png"
            }
        ],

        // FRETE CALCULADO
        shipping: {
            type: "CALCULATE",

            // Permite que o cliente informe o endereço
            address_modifiable: true,

        // Dados da embalagem
       box: {
  weight: 300,
  dimensions: {
    length: 15,
    width: 10,
    height: 2
  }
}


            
        },

        // Formas de pagamento
        payment_methods: [
            {
                type: "PIX"
            },
            {
                type: "CREDIT_CARD"
            },
            {
                type: "BOLETO"
            }
        ],

        // Valores
        additional_amount: 0,
        discount_amount: 0,

        // Retorno
        redirect_url: "https://www.rlvformulas.com.br",
        redirect_waiting_time: 5
    }
}

export function extractCheckoutUrl(data = {}) {
    const links = Array.isArray(data.links) ? data.links : []
    const candidate = links.find((link) => {
        const rel = String(link?.rel || "").toUpperCase()
        return rel === "PAY" || rel === "CHECKOUT" || rel === "PAYMENT"
    })

    if (candidate?.href) {
        return candidate.href
    }

    return data.checkout_url || data.checkoutUrl || data.payment_url || data.paymentUrl || data.link || ""
}

export async function createCheckout(requestData = {}) {
    if (!getPagBankToken()) {
        throw new Error("Token do PagBank não configurado. Defina PAGBANK_TOKEN no arquivo backend/config/.env")
    }

    const payload = buildCheckoutPayload(requestData)

    try {
        const response = await apiPagBank.post("/checkouts", payload)
        const checkoutUrl = extractCheckoutUrl(response?.data || {})

        if (!checkoutUrl) {
            throw new Error("Checkout não retornou uma URL válida")
        }

        return checkoutUrl
    } catch (error) {
        const responseData = error?.response?.data
        const apiMessage = extractErrorMessage(responseData) || error?.message
        throw new Error(apiMessage || "Erro ao criar checkout")
    }
}

function extractErrorMessage(responseData) {
    if (!responseData) return ""

    if (Array.isArray(responseData.error_messages)) {
        return responseData.error_messages
            .map((item) => {
                if (typeof item === "string") return item
                if (typeof item === "object") {
                    return item.message || item.description || item.error || JSON.stringify(item)
                }
                return String(item)
            })
            .join(" | ")
    }

    if (typeof responseData === "string") return responseData

    if (typeof responseData.message === "string") return responseData.message
    if (typeof responseData.error === "string") return responseData.error
    if (typeof responseData.detail === "string") return responseData.detail

    return JSON.stringify(responseData)
}
