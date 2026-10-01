import assert from "node:assert/strict"
import test from "node:test"
import { handlePagBankWebhook } from "./webhook.controller.js"

test("acknowledges a paid PagBank webhook when Melhor Envio fulfillment fails", async () => {
  const localOrder = { pagbankOrderId: "ORDER-123", status: "WAITING" }
  let savedOrder
  const result = await handlePagBankWebhook({ id: "ORDER-123" }, {
    findOrderByPagBankId: async () => localOrder,
    getPagBankOrder: async () => ({ charges: [{ status: "PAID" }] }),
    saveOrder: async (order) => {
      savedOrder = order
      return order
    },
    fulfillPaidOrder: async () => { throw new Error("Melhor Envio indisponível") }
  })

  assert.equal(savedOrder.status, "paid")
  assert.deepEqual(result, {
    status: "paid",
    fulfillmentStatus: "pending",
    trackingCode: null,
    label: null
  })
})