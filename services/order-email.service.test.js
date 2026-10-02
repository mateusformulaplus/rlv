import assert from "node:assert/strict"
import test from "node:test"
import { buildTrackingEmail, resolveTrackingRecipient, sendOrderNotification, sendTrackingNotification } from "./order-email.service.js"

const emailJsVariables = [
  "EMAILJS_SERVICE_ID",
  "EMAILJS_ORDER_TEMPLATE_ID",
  "EMAILJS_TRACKING_TEMPLATE_ID",
  "EMAILJS_PUBLIC_KEY",
  "EMAILJS_PRIVATE_KEY",
  "EMAILJS_TO_EMAIL",
  "EMAILJS_TRACKING_TO_EMAIL"
]

async function withEmailJsEnvironment(values, run) {
  const originalValues = Object.fromEntries(emailJsVariables.map((name) => [name, process.env[name]]))
  for (const name of emailJsVariables) {
    if (values[name] === undefined) delete process.env[name]
    else process.env[name] = values[name]
  }

  try {
    return await run()
  } finally {
    for (const name of emailJsVariables) {
      if (originalValues[name] === undefined) delete process.env[name]
      else process.env[name] = originalValues[name]
    }
  }
}

const completeConfiguration = {
  EMAILJS_SERVICE_ID: "service_test",
  EMAILJS_ORDER_TEMPLATE_ID: "template_order_test",
  EMAILJS_TRACKING_TEMPLATE_ID: "template_tracking_test",
  EMAILJS_PUBLIC_KEY: "public_test",
  EMAILJS_PRIVATE_KEY: "private_test"
}

test("skips order email when EmailJS is not fully configured", async () => {
  await withEmailJsEnvironment({}, async () => {
    assert.deepEqual(await sendOrderNotification({ orderId: "test-order" }), {
      sent: false,
      reason: "not_configured"
    })
  })
})

test("uses tracking override or falls back to customer", async () => {
  await withEmailJsEnvironment({ EMAILJS_TRACKING_TO_EMAIL: "testing@example.com" }, async () => {
    assert.equal(resolveTrackingRecipient({ email: "cliente@example.com" }), "testing@example.com")
  })
  await withEmailJsEnvironment({}, async () => {
    assert.equal(resolveTrackingRecipient({ email: "cliente@example.com" }), "cliente@example.com")
    assert.equal(resolveTrackingRecipient({}), "")
  })
})

test("builds a tracking email with the RLV brand palette", () => {
  const email = buildTrackingEmail({
    orderId: "kit-1",
    customer: { name: "Cliente <Teste>" },
    shipping: { serviceName: "Correios" },
    trackingCode: "BR123456789"
  })

  assert.match(email.html, /#006c47/i)
  assert.match(email.html, /#e8f5ed/i)
  assert.match(email.html, /#f2fbf6/i)
  assert.match(email.html, /Cliente &lt;Teste&gt;/)
  assert.match(email.text, /Código de rastreio: BR123456789/)
})

test("sends tracking template params to EmailJS", async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return { ok: true, text: async () => "OK" }
  }

  try {
    await withEmailJsEnvironment({
      ...completeConfiguration,
    }, async () => {
      assert.deepEqual(await sendTrackingNotification({
        orderId: "kit-1",
        customer: { name: "Cliente Teste", email: "cliente@example.com" },
        shipping: { serviceName: "Correios" },
        trackingCode: "BR123456789"
      }), { sent: true, id: null })
    })

    assert.equal(request.url, "https://api.emailjs.com/api/v1.0/email/send")
    const body = JSON.parse(request.options.body)
    assert.equal(body.service_id, "service_test")
    assert.equal(body.template_id, "template_tracking_test")
    assert.equal(body.user_id, "public_test")
    assert.equal(body.accessToken, "private_test")
    assert.equal(body.template_params.to_email, "cliente@example.com")
    assert.equal(body.template_params.name, "Cliente Teste")
    assert.equal(body.template_params.tracking_code, "BR123456789")
    assert.match(body.template_params.message, /Código de rastreio: BR123456789/)
    assert.match(body.template_params.message_html, /BR123456789/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("reports EmailJS API errors", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, text: async () => "Template not found" })

  try {
    await withEmailJsEnvironment(completeConfiguration, async () => {
      await assert.rejects(
        sendOrderNotification({ orderId: "test-order" }),
        /Template not found/
      )
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})