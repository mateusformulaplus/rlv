import assert from "node:assert/strict"
import test from "node:test"
import { saveOrder, toExpedicaoPedidoData } from "./order.service.js"

function mockPrisma({ upsertExpedition = async ({ create }) => create } = {}) {
  const transaction = {
    order: {
      upsert: async ({ create }) => ({
        ...create,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z")
      })
    },
    expedicaoPedido: {
      findUnique: async () => null,
      upsert: upsertExpedition
    }
  }

  return { $transaction: (callback) => callback(transaction) }
}

test("maps PagBank orders into the expedition dashboard record", () => {
  const pedido = toExpedicaoPedidoData({
    pagbankOrderId: "ORDER-123",
    referenceId: "KIT-3-123",
    status: "fulfilled",
    customer: { name: "Cliente Teste", email: "cliente@example.com", phone: "11999990000" },
    product: { name: "Kit RLV", quantity: 2 },
    shippingAmount: 15.5,
    shipping: {
      service: 4,
      serviceName: "Correios - PAC",
      to: {
        address: "Rua das Flores",
        number: "100",
        district: "Centro",
        city: "Niterói",
        state_abbr: "RJ",
        postal_code: "24000-000"
      },
      volumes: [{ weight: 0.5, width: 10, height: 12, length: 16 }]
    },
    melhorEnvioPurchased: true,
    melhorEnvioShipmentId: "SHIP-1",
    melhorEnvioLabel: { data: "cGRm", contentType: "application/pdf" },
    trackingCode: "BR123456789"
  })

  assert.equal(pedido.codigoPedido, "KIT-3-123")
  assert.equal(pedido.pagbankOrderId, "ORDER-123")
  assert.equal(pedido.statusPagamento, "Pago")
  assert.equal(pedido.clienteNome, "Cliente Teste")
  assert.equal(pedido.clienteTelefone, "11999990000")
  assert.equal(pedido.produtoNome, "Kit RLV")
  assert.equal(pedido.produtoQuantidade, 2)
  assert.equal(pedido.enderecoCompleto, "Rua das Flores, 100 - Centro, Niterói/RJ, 24000-000")
  assert.equal(pedido.frete, "Correios - PAC")
  assert.equal(pedido.valorFrete, 15.5)
  assert.equal(pedido.statusExpedicao, "Etiqueta disponível")
  assert.equal(pedido.codigoRastreio, "BR123456789")
  assert.equal(pedido.etiquetaDisponivel, true)
  assert.equal(pedido.dimensoes, "10x12x16 cm")

  const legacyOrder = toExpedicaoPedidoData({
    pagbankOrderId: "ORDER-LEGACY",
    shipping: { service: 3 }
  })
  assert.equal(legacyOrder.frete, "Serviço 3")
})

test("saves PagBank and expedition records in one transaction", async () => {
  const order = {
    pagbankOrderId: "ORDER-ATOMIC",
    referenceId: "KIT-ATOMIC",
    status: "paid",
    customer: { name: "Cliente Teste" },
    product: { name: "Kit RLV", quantity: 1 }
  }
  let expeditionRecord
  const prisma = mockPrisma({
    upsertExpedition: async ({ create }) => {
      expeditionRecord = create
      return create
    }
  })

  const savedOrder = await saveOrder(order, prisma)

  assert.equal(savedOrder.pagbankOrderId, "ORDER-ATOMIC")
  assert.equal(expeditionRecord.pagbankOrderId, "ORDER-ATOMIC")
  assert.equal(expeditionRecord.statusPagamento, "Pago")
})

test("propagates expedition write failures so the transaction can roll back", async () => {
  const prisma = mockPrisma({
    upsertExpedition: async () => { throw new Error("database unavailable") }
  })

  await assert.rejects(
    saveOrder({ pagbankOrderId: "ORDER-FAIL", status: "paid" }, prisma),
    /database unavailable/
  )
})