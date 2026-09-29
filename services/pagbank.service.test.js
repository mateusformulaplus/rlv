import assert from "node:assert/strict"
import test from "node:test"
import { extractPixDetails } from "./pagbank.service.js"

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