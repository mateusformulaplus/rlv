import assert from "node:assert/strict"
import test from "node:test"
import { sendTrackingNotification } from "./tracking-email.service.js"

const variableNames = [
  "EMAILJS_SERVICE_ID",
  "EMAILJS_TRACKING_TEMPLATE_ID",
  "EMAILJS_PUBLIC_KEY",
  "EMAILJS_PRIVATE_KEY",
  "EMAILJS_TRACKING_TO_EMAIL"
]

async function withEnvironment(values, run) {
  const originalValues = Object.fromEntries(variableNames.map((name) => [name, process.env[name]]))
  for (const name of variableNames) {
    if (values[name] === undefined) delete process.env[name]
    else process.env[name] = values[name]
  }

  try {
    return await run()
  } finally {
    for (const name of variableNames) {
      if (originalValues[name] === undefined) delete process.env[name]
      else process.env[name] = originalValues[name]
    }
  }
}

const emailJsConfiguration = {
  EMAILJS_SERVICE_ID: "service_test",
  EMAILJS_TRACKING_TEMPLATE_ID: "template_tracking_test",
  EMAILJS_PUBLIC_KEY: "public_test",
  EMAILJS_PRIVATE_KEY: "private_test"
}

test("reports missing EmailJS configuration without sending", async () => {
  await withEnvironment({}, async () => {
    assert.deepEqual(await sendTrackingNotification({ trackingCode: "BR123456789" }), {
      sent: false,
      reason: "not_configured"
    })
  })
})

test("sends tracking template variables to the customer via EmailJS", async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return { ok: true, text: async () => "OK" }
  }

  try {
    await withEnvironment(emailJsConfiguration, async () => {
      assert.deepEqual(await sendTrackingNotification({
        orderId: "kit-1",
        customer: { name: "Cliente Teste", email: "cliente@example.com" },
        trackingCode: "BR123456789"
      }), { sent: true })
    })

    assert.equal(request.url, "https://api.emailjs.com/api/v1.0/email/send")
    const body = JSON.parse(request.options.body)
    assert.equal(body.service_id, "service_test")
    assert.equal(body.template_id, "template_tracking_test")
    assert.equal(body.template_params.to_email, "cliente@example.com")
    assert.equal(body.template_params.name, "Cliente Teste")
    assert.equal(body.template_params.tracking_code, "BR123456789")
  } finally {
    globalThis.fetch = originalFetch
  }
})