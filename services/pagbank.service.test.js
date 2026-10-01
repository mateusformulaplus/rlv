import assert from "node:assert/strict"
import test from "node:test"
import { buildTransparentOrderPayload, extractPixDetails } from "./pagbank.service.js"

test("builds PagBank transparent Pix payment with expiration date", () => {
    const generatedAt = Date.now()
    const payload = buildTransparentOrderPayload({
        paymentMethod: "PIX",
        amount: 25,
        shippingAmount: 5
    })
    const paymentMethod = payload.charges[0].payment_method

    assert.equal(paymentMethod.type, "PIX")
    assert.match(paymentMethod.pix.expiration_date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    assert.ok(Date.parse(paymentMethod.pix.expiration_date) > generatedAt)
    assert.ok(Date.parse(paymentMethod.pix.expiration_date) - generatedAt <= 23 * 60 * 60 * 1000)
    assert.equal("installments" in paymentMethod, false)
    assert.equal("capture" in paymentMethod, false)
})

test("keeps card payment fields for credit card", () => {
    const payload = buildTransparentOrderPayload({
        paymentMethod: "CREDIT_CARD",
        amount: 25,
        installments: 3,
        cardToken: "encrypted-card"
    })

    assert.equal(payload.charges[0].payment_method.installments, 3)
    assert.equal(payload.charges[0].payment_method.capture, true)
})

test("builds debit payment without credit installment fields", () => {
    const payload = buildTransparentOrderPayload({
        paymentMethod: "DEBIT_CARD",
        amount: 25,
        cardToken: "encrypted-card"
    })
    const paymentMethod = payload.charges[0].payment_method

    assert.equal(paymentMethod.type, "DEBIT_CARD")
    assert.equal("installments" in paymentMethod, false)
    assert.equal("capture" in paymentMethod, false)
})

test("extracts Pix QR code from legacy charge response", () => {
    const result = extractPixDetails({
        charges: [{
            payment_method: {
                qr_codes: [{
                    text: "pix-copy-and-paste",
                    links: [{ media: "image/png", href: "https://example.test/pix.png" }]
                }]
            }
        }]
    })

    assert.deepEqual(result, {
        qrCodeText: "pix-copy-and-paste",
        qrCodeImage: "https://example.test/pix.png"
    })
})

test("extracts Pix QR code from order-level response", () => {
    const result = extractPixDetails({
        qr_codes: [{
            text: "order-pix-code",
            links: [{ rel: "QRCODE.PNG", href: "https://example.test/order.png" }]
        }]
    })

    assert.deepEqual(result, {
        qrCodeText: "order-pix-code",
        qrCodeImage: "https://example.test/order.png"
    })
})

test("extracts Pix QR code from charge qr_code response", () => {
    const result = extractPixDetails({
        charges: [{
            qr_code: { text: "charge-pix-code" },
            links: [{ rel: "QRCODE.PNG", href: "https://example.test/charge.png" }]
        }]
    })

    assert.deepEqual(result, {
        qrCodeText: "charge-pix-code",
        qrCodeImage: "https://example.test/charge.png"
    })
})

test("keeps kit pricing intact while validating the actual shipping quantity", () => {
    const payload = buildTransparentOrderPayload({ quantity: 6 })
    assert.equal(payload.items[0].quantity, 1)

    for (const quantity of [0, -1, 1.5, 101, Number.NaN]) {
        assert.throws(() => buildTransparentOrderPayload({ quantity }), /quantidade/i)
    }

    const legacyKitPayload = buildTransparentOrderPayload({ quantity: 1, referenceId: "kit-4", amount: 306 })
    assert.equal(legacyKitPayload.items[0].quantity, 1)
    assert.equal(legacyKitPayload.items[0].unit_amount, 30600)
})