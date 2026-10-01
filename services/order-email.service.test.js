import assert from "node:assert/strict"
import test from "node:test"
import { sendOrderNotification, sendTrackingNotification } from "./order-email.service.js"

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
  assert.deepEqual(await sendTrackingNotification({
    orderId: "test-order",
    customer: {},
    trackingCode: "BR123456789"
  }), {
    sent: false,
    reason: "missing_customer_email"
  })
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
  process.env.RESEND_API_KEY = "re_test_key"
  delete process.env.RESEND_FROM_EMAIL

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
  }
})
