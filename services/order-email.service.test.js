import assert from "node:assert/strict"
import test from "node:test"
import { buildTrackingEmail, resolveTrackingRecipient, sendOrderNotification, sendTrackingNotification } from "./order-email.service.js"

test("skips order email when Resend is not configured", async () => {
  const originalApiKey = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY

  try {
    assert.deepEqual(await sendOrderNotification({ orderId: "test-order" }), {
      sent: false,
      reason: "not_configured"
    })
  } finally {
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = originalApiKey
  }
})

test("does not send a tracking email without the customer's address", async () => {
  const originalRecipient = process.env.RESEND_TO_EMAIL
  delete process.env.RESEND_TO_EMAIL

  try {
  assert.deepEqual(await sendTrackingNotification({
    orderId: "test-order",
    customer: {},
    trackingCode: "BR123456789"
  }), {
    sent: false,
    reason: "missing_recipient"
  })
  } finally {
    if (originalRecipient === undefined) delete process.env.RESEND_TO_EMAIL
    else process.env.RESEND_TO_EMAIL = originalRecipient
  }
})

test("uses the configured Resend recipient for tracking notifications", () => {
  const originalRecipient = process.env.RESEND_TO_EMAIL
  const originalSender = process.env.RESEND_FROM_EMAIL
  process.env.RESEND_TO_EMAIL = "expedicao@example.com"
  process.env.RESEND_FROM_EMAIL = "envios@rlv.example"

  try {
    assert.equal(resolveTrackingRecipient({ email: "customer@example.com" }), "expedicao@example.com")
  } finally {
    if (originalRecipient === undefined) delete process.env.RESEND_TO_EMAIL
    else process.env.RESEND_TO_EMAIL = originalRecipient
    if (originalSender === undefined) delete process.env.RESEND_FROM_EMAIL
    else process.env.RESEND_FROM_EMAIL = originalSender
  }
})

test("uses the Resend account owner when using the test sender", () => {
  const originalRecipient = process.env.RESEND_TO_EMAIL
  process.env.RESEND_TO_EMAIL = "old-render-address@example.com"

  try {
    assert.equal(
      resolveTrackingRecipient({ email: "customer@example.com" }, "onboarding@resend.dev"),
      "expedicao@formulaplus.com.br"
    )
  } finally {
    if (originalRecipient === undefined) delete process.env.RESEND_TO_EMAIL
    else process.env.RESEND_TO_EMAIL = originalRecipient
  }
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

test("skips tracking email when Resend is not configured", async () => {
  const originalApiKey = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY

  try {
    assert.deepEqual(await sendTrackingNotification({
      orderId: "test-order",
      customer: { email: "customer@example.com" },
      trackingCode: "BR123456789"
    }), {
      sent: false,
      reason: "not_configured"
    })
  } finally {
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = originalApiKey
  }
})

test("requires a configured sender for customer tracking emails", async () => {
  const originalApiKey = process.env.RESEND_API_KEY
  const originalSender = process.env.RESEND_FROM_EMAIL
  const originalRecipient = process.env.RESEND_TO_EMAIL
  process.env.RESEND_API_KEY = "re_test_key"
  delete process.env.RESEND_FROM_EMAIL
  process.env.RESEND_TO_EMAIL = "expedicao@example.com"

  try {
    assert.deepEqual(await sendTrackingNotification({
      orderId: "test-order",
      customer: { email: "customer@example.com" },
      trackingCode: "BR123456789"
    }), {
      sent: false,
      reason: "sender_not_configured"
    })
  } finally {
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = originalApiKey
    if (originalSender === undefined) delete process.env.RESEND_FROM_EMAIL
    else process.env.RESEND_FROM_EMAIL = originalSender
    if (originalRecipient === undefined) delete process.env.RESEND_TO_EMAIL
    else process.env.RESEND_TO_EMAIL = originalRecipient
  }
})
