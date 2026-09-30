import assert from "node:assert/strict"
import test from "node:test"
import { toExpedicaoPedidoData } from "./order.service.js"

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