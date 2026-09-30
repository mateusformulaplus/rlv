import assert from "node:assert/strict"
import test from "node:test"
import { sendOrderNotification } from "./order-email.service.js"

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
