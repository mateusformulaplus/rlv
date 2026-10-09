import { apiPagBank, getPagBankPublicKey, getPagBankToken } from "../lib/axiso.js"
import { saveOrder } from "./order.service.js"
import { isValidPostalCode, normalizeOrderShipping, resolveShippingQuantity } from "./shipping.service.js"


export function buildCheckoutPayload({
    productName = "RLV Fórmulas",
    amount = 0,
    quantity = 1,
    referenceId,
    customer = {},
    shippingAmount = null,
    paymentMethod = "CREDIT_CARD",
    notificationUrl
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

        shipping: shippingAmount !== null
            ? {
                type: "FIXED",
                amount: Math.round(Number(shippingAmount) * 100),
                address_modifiable: true
            }
            : {
                type: "CALCULATE",
                address_modifiable: true,
                box: {
                    weight: 210,
                    dimensions: {
                        length: 2,
                        width: 12,
                        height: 18
                    }
                }
            },

        // Formas de pagamento
        payment_methods: paymentMethod === "ALL"
            ? [{ type: "PIX" }, { type: "CREDIT_CARD" }, { type: "DEBIT_CARD" }]
            : [{ type: paymentMethod }],
        notification_urls: notificationUrl ? [notificationUrl] : undefined,

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

    const payload = buildCheckoutPayload({
        ...requestData,
        paymentMethod: requestData.paymentMethod || "CREDIT_CARD",
        notificationUrl: requestData.notificationUrl
            || process.env.PAGBANK_WEBHOOK_URL
            || "https://rlv-ttmm.onrender.com/api/pagbank/webhook"
    })

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

export function getTransparentCheckoutPublicKey() {
    return getPagBankPublicKey()
}


function isValidTaxId(value) {
    const digits = String(value || "").replace(/\D/g, "")
    if (/^(\d)\1+$/.test(digits)) return false

    const calculateDigit = (base, weights) => {
        const sum = weights.reduce((total, weight, index) => total + Number(base[index]) * weight, 0)
        const remainder = sum % 11
        return remainder < 2 ? 0 : 11 - remainder
    }

    if (digits.length === 11) {
        const firstDigit = calculateDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2])
        const secondDigit = calculateDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
        return firstDigit === Number(digits[9]) && secondDigit === Number(digits[10])
    }

    if (digits.length === 14) {
        const firstDigit = calculateDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
        const secondDigit = calculateDigit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
        return firstDigit === Number(digits[12]) && secondDigit === Number(digits[13])
    }

    return false
}

export function buildTransparentOrderPayload({
    productName = "RLV Fórmulas",
    amount = 0,
    quantity = 1,
    referenceId,
    shippingAmount = 0,
    customer = {},
    shipping = {},
    notificationUrl,
    paymentMethod = "PIX",
    cardToken,
    cardHolder,
    installments = 1
} = {}) {
    const safeQuantity = resolveShippingQuantity(quantity, referenceId)
    const totalAmount = Math.round((Number(amount || 0) + Number(shippingAmount || 0)) * 100)
    const rawTaxId = String(customer.taxId || customer.tax_id || "").replace(/\D/g, "")
    const phoneDigits = String(customer.phone || customer.celular || customer.mobile || shipping?.to?.phone || "11999999999").replace(/\D/g, "")
    const areaCode = phoneDigits.length >= 10 ? phoneDigits.slice(0, 2) : "11"
    const phoneNumber = phoneDigits.length >= 10 ? phoneDigits.slice(2, 11) : "999999999"

    // Card holder name must have at least two words for PagBank
    let holderName = String(cardHolder || customer.name || "Cliente RLV").trim()
    if (holderName.split(" ").filter(Boolean).length < 2) {
        holderName = `${holderName} Silva`
    }

    let customerName = String(customer.name || "Cliente RLV").trim()
    if (customerName.split(" ").filter(Boolean).length < 2) {
        customerName = `${customerName} Silva`
    }

    const paymentMethodDetails = { type: paymentMethod }
    if (paymentMethod === "PIX") {
        const pixExpirationDate = new Date(Date.now() + 23 * 60 * 60 * 1000)
        pixExpirationDate.setMilliseconds(0)
        paymentMethodDetails.pix = {
            expiration_date: pixExpirationDate.toISOString().replace(/\.\d{3}Z$/, "Z")
        }
    } else if (paymentMethod === "CREDIT_CARD") {
        paymentMethodDetails.installments = Number(installments || 1)
        paymentMethodDetails.capture = true
    }

    const payload = {
        reference_id: referenceId || `rlv-${Date.now()}`,
        customer: {
            name: customerName,
            email: customer.email,
            tax_id: rawTaxId,
            phones: [
                {
                    country: "55",
                    area: areaCode,
                    number: phoneNumber,
                    type: "MOBILE"
                }
            ]
        },
        items: [
            {
                reference_id: referenceId || `item-${Date.now()}`,
                name: productName,
                quantity: 1,
                unit_amount: Math.round(Number(amount || 0) * 100)
            }
        ],
        shipping: shipping?.to ? {
            address: {
                street: shipping.to.address || "Rua",
                number: shipping.to.number || "SN",
                complement: String(shipping.to.complement || "").trim() || "Sem complemento",
                locality: shipping.to.district || "Bairro",
                city: shipping.to.city || "Cidade",
                region_code: (shipping.to.state_abbr || "SP").toUpperCase(),
                country: "BRA",
                postal_code: String(shipping.to.postal_code || "").replace(/\D/g, "")
            }
        } : undefined,
        notification_urls: notificationUrl ? [notificationUrl] : undefined,
        charges: [
            {
                reference_id: referenceId || `charge-${Date.now()}`,
                description: `Compra ${productName}`,
                amount: {
                    value: totalAmount,
                    currency: "BRL"
                },
                payment_method: paymentMethodDetails
            }
        ]
    }

    if (paymentMethod === "CREDIT_CARD" || paymentMethod === "DEBIT_CARD") {
        if (!cardToken) {
            throw new Error("Token criptografado do cartão não informado.")
        }
        payload.charges[0].payment_method.card = {
            encrypted: cardToken,
            store: false,
            holder: {
                name: holderName
            }
        }
    }

    return payload
}

export function extractPixDetails(order = {}) {
    const charge = order.charges?.[0] || {}
    const candidates = [
        charge.payment_method?.qr_codes?.[0],
        charge.payment_method?.pix?.qr_codes?.[0],
        order.qr_codes?.[0],
        charge.qr_code,
        charge.payment_method?.pix?.qr_code,
        charge.payment_method?.pix
    ].filter(Boolean)
    const qrCode = candidates.find((candidate) => typeof candidate.text === "string") || {}
    const links = [
        ...(Array.isArray(qrCode.links) ? qrCode.links : []),
        ...(Array.isArray(charge.links) ? charge.links : []),
        ...(Array.isArray(order.links) ? order.links : [])
    ]
    const imageLink = links.find((link) =>
        String(link?.media || "").toLowerCase() === "image/png"
        || String(link?.rel || "").toUpperCase() === "QRCODE.PNG"
    )

    return {
        qrCodeText: qrCode.text || "",
        qrCodeImage: imageLink?.href || ""
    }
}

export async function createTransparentOrder(requestData = {}) {
    const quantity = resolveShippingQuantity(requestData.quantity ?? 1, requestData.referenceId)
    const shipping = normalizeOrderShipping(requestData.shipping || {}, quantity)
    if (!getPagBankToken()) {
        throw new Error("Token do PagBank não configurado")
    }

    const customer = requestData.customer || {}
    if (!customer.name || !customer.email || !isValidTaxId(customer.taxId)) {
        throw new Error("Nome, e-mail e CPF/CNPJ válido são obrigatórios")
    }
    const postalCode = String(shipping.to?.postal_code || "").replace(/\D/g, "")
    if (!shipping.service || !postalCode || !isValidPostalCode(postalCode)) {
        throw new Error("Opção de envio e um CEP de entrega válido com 8 números são obrigatórios")
    }

    try {
        const notificationUrl = requestData.notificationUrl
            || process.env.PAGBANK_WEBHOOK_URL
            || "https://rlv-ttmm.onrender.com/api/pagbank/webhook"
        const payload = buildTransparentOrderPayload({ ...requestData, quantity, shipping, notificationUrl })
        const response = await apiPagBank.post("/orders", payload)
        const charge = response.data?.charges?.[0] || {}
        const pixDetails = extractPixDetails(response.data || {})
        const status = charge.status || response.data?.status || "WAITING"

        await saveOrder({
            pagbankOrderId: response.data?.id,
            pagbankChargeId: charge.id,
            referenceId: requestData.referenceId,
            status,
            product: {
                name: requestData.productName,
                amount: Number(requestData.amount || 0),
                quantity
            },
            customer,
            shipping,
            shippingAmount: Number(requestData.shippingAmount || 0)
        })

        return {
            orderId: response.data?.id,
            chargeId: charge.id,
            status,
            paymentResponse: charge.payment_response,
            ...pixDetails
        }
    } catch (error) {
        const responseData = error?.response?.data
        const apiMessage = extractErrorMessage(responseData) || error?.message
        throw new Error(apiMessage || "Erro ao criar pedido transparente")
    }
}

export const createTransparentPixOrder = createTransparentOrder

export async function getPagBankOrder(orderId) {
    const response = await apiPagBank.get(`/orders/${orderId}`)
    return response.data
}

function extractErrorMessage(responseData) {
    if (!responseData) return ""

    if (Array.isArray(responseData.error_messages)) {
        return responseData.error_messages
            .map((item) => {
                if (typeof item === "string") return item
                if (typeof item === "object") {
                    const desc = item.description || item.message || item.error || ""
                    const param = item.parameter_name ? ` (Parâmetro: ${item.parameter_name})` : ""
                    const code = item.code ? `[${item.code}] ` : ""
                    return `${code}${desc}${param}`.trim() || JSON.stringify(item)
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
