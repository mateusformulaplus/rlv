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
    syncPaidOrderToBling: async () => ({ synced: false, reason: "not_configured" }),
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

test("persists the Bling sale id after a paid order sync", async () => {
  const savedOrders = []
  let syncedOrderId = null
  const result = await handlePagBankWebhook({ id: "ORDER-456" }, {
    findOrderByPagBankId: async () => ({ pagbankOrderId: "ORDER-456", status: "WAITING" }),
    getPagBankOrder: async () => ({ charges: [{ status: "PAID" }] }),
    saveOrder: async (order) => {
      savedOrders.push(order)
      return order
    },
    syncPaidOrderToBling: async (order) => {
      syncedOrderId = order.pagbankOrderId
      return { synced: true, id: 98765 }
    },
    fulfillPaidOrder: async (order) => ({
      ...order,
      status: "fulfilled",
      trackingCode: "BR123456789",
      melhorEnvioLabel: { url: "https://label.example" }
    })
  })

  assert.equal(syncedOrderId, "ORDER-456")
  assert.equal(savedOrders[1].blingOrderId, "98765")
  assert.deepEqual(result, {
    status: "fulfilled",
    trackingCode: "BR123456789",
    label: { url: "https://label.example" }
  })
})