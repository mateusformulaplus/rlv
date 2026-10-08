import assert from "node:assert/strict"
import test from "node:test"
import {
  buildBlingSalesOrderPayload,
  completeBlingAuthorization,
  createBlingAuthorizationUrl,
  syncPaidOrderToBling
} from "./bling.service.js"

const blingVariables = ["BLING_CLIENT_ID", "BLING_CLIENT_SECRET", "BLING_REDIRECT_URI"]
const blingEnvironment = {
  BLING_CLIENT_ID: "client-test",
  BLING_CLIENT_SECRET: "secret-test",
  BLING_REDIRECT_URI: "https://example.com/api/bling/callback"
}

async function withEnvironment(values, run) {
  const originalValues = Object.fromEntries(blingVariables.map((name) => [name, process.env[name]]))
  for (const name of blingVariables) {
    if (values[name] === undefined) delete process.env[name]
    else process.env[name] = values[name]
  }

  try {
    return await run()
  } finally {
    for (const name of blingVariables) {
      if (originalValues[name] === undefined) delete process.env[name]
      else process.env[name] = originalValues[name]
    }
  }
}

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) }
}

const paidOrder = {
  pagbankOrderId: "PAG-123",
  referenceId: "kit-2",
  status: "paid",
  product: { name: "Kit 2 Soluções", amount: 129, quantity: 2 },
  customer: { name: "Cliente Teste", email: "cliente@example.com", taxId: "123.456.789-09" },
  shipping: { volumes: [{ weight: 0.0422 }] },
  shippingAmount: 12.5,
  pagbank: { charges: [{ status: "PAID", payment_method: { type: "PIX" } }] }
}

test("creates a state-protected Bling authorization URL", async () => {
  let savedState
  await withEnvironment(blingEnvironment, async () => {
    const url = await createBlingAuthorizationUrl({
      blingOAuthState: { create: async ({ data }) => { savedState = data } }
    })
    const parsed = new URL(url)

    assert.equal(parsed.origin, "https://www.bling.com.br")
    assert.equal(parsed.searchParams.get("client_id"), "client-test")
    assert.equal(parsed.searchParams.get("redirect_uri"), blingEnvironment.BLING_REDIRECT_URI)
    assert.equal(parsed.searchParams.get("state"), savedState.state)
    assert.ok(savedState.expiresAt > new Date())
  })
})

test("exchanges authorization code and persists rotating tokens", async () => {
  let savedCredential
  let deletedState
  let request
  await withEnvironment(blingEnvironment, async () => {
    const result = await completeBlingAuthorization("code-test", "state-test", {
      prisma: {
        blingOAuthState: {
          findUnique: async () => ({ state: "state-test", expiresAt: new Date(Date.now() + 60_000) }),
          delete: async ({ where }) => { deletedState = where.state }
        },
        blingCredential: { upsert: async ({ create }) => { savedCredential = create } }
      },
      fetch: async (url, options) => {
        request = { url, options }
        return response({ access_token: "access-test", refresh_token: "refresh-test", expires_in: 3600 })
      }
    })

    assert.deepEqual(result, { connected: true })
  })

  assert.equal(deletedState, "state-test")
  assert.equal(request.url, "https://api.bling.com.br/Api/v3/oauth/token")
  assert.match(request.options.headers.Authorization, /^Basic /)
  assert.match(request.options.body, /grant_type=authorization_code/)
  assert.equal(savedCredential.accessToken, "access-test")
  assert.equal(savedCredential.refreshToken, "refresh-test")
})

test("builds a linked kit sale with the price, shipping total and PagBank payment type", () => {
  const orderWithCarrier = {
    ...paidOrder,
    shipping: {
      serviceName: "Correios - PAC",
      company: { name: "Correios" },
      volumes: [{ weight: 0.0422 }]
    }
  }
  const payload = buildBlingSalesOrderPayload(orderWithCarrier, 21, 34, "2026-10-02", { id: 98, sku: "RLV-MIC-02" })

  assert.equal(payload.numeroLoja, "PAG-123")
  assert.equal(payload.contato.id, 21)
  assert.deepEqual(payload.itens[0], {
    descricao: "Kit 2 Soluções",
    quantidade: 1,
    valor: 129,
    valorLista: 129,
    unidade: "UN",
    codigo: "RLV-MIC-02",
    produto: { id: 98 }
  })
  assert.equal(payload.parcelas[0].valor, 141.5)
  assert.equal(payload.parcelas[0].formaPagamento.id, 34)
  assert.equal(payload.transporte.frete, 12.5)
  assert.equal(payload.transporte.pesoBruto, 0.0422)
  assert.equal(payload.transporte.transportador.nome, "Correios")
  assert.equal(payload.transporte.volumes[0].servico, "Correios - PAC")
  assert.equal(payload.transporte.volumes[0].pesoBruto, 0.0422)
  assert.equal(payload.transporte.volumes[0].valorDeclarado, 129)
  assert.equal(payload.transporte.volumes[0].largura, 12)
  assert.equal(payload.transporte.volumes[0].altura, 18)
  assert.equal(payload.transporte.volumes[0].comprimento, 2)
  assert.equal(payload.observacoes, "Forma de Envio: Correios - PAC")
  assert.match(payload.observacoesInternas, /Frete: Correios - PAC/)
})

test("creates a sale once using PagBank order id and finds or creates its contact", async () => {
  const requests = []
  const credential = {
    accessToken: "access-test",
    refreshToken: "refresh-test",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000)
  }
  const prisma = {
    blingCredential: { findUnique: async () => credential },
    blingOAuthState: {}
  }
  await withEnvironment(blingEnvironment, async () => {
    const result = await syncPaidOrderToBling(paidOrder, {
      prisma,
      fetch: async (url, options) => {
        const parsed = new URL(url)
        const body = options.body ? JSON.parse(options.body) : undefined
        requests.push({ path: parsed.pathname, search: parsed.search, method: options.method, body })

        if (parsed.pathname === "/Api/v3/pedidos/vendas" && options.method === "GET") return response({ data: [] })
        if (parsed.pathname === "/Api/v3/contatos" && options.method === "GET") return response({ data: [] })
        if (parsed.pathname === "/Api/v3/contatos" && options.method === "POST") return response({ data: { id: 21 } }, 201)
        if (parsed.pathname === "/Api/v3/produtos") return response({ data: [{ id: 98, codigo: "RLV-MIC-02" }] })
        if (parsed.pathname === "/Api/v3/formas-pagamentos") return response({ data: [{ id: 34 }] })
        if (parsed.pathname === "/Api/v3/pedidos/vendas" && options.method === "POST") return response({ data: { id: 55 } }, 201)
        throw new Error(`Unexpected Bling request: ${options.method} ${url}`)
      }
    })

    assert.deepEqual(result, { synced: true, id: 55, existing: false })
  })

  const contactRequest = requests.find((request) => request.path === "/Api/v3/contatos" && request.method === "POST")
  const saleRequest = requests.find((request) => request.path === "/Api/v3/pedidos/vendas" && request.method === "POST")
  assert.equal(contactRequest.body.numeroDocumento, "12345678909")
  assert.equal(saleRequest.body.contato.id, 21)
  assert.equal(saleRequest.body.itens[0].produto.id, 98)
  assert.equal(saleRequest.body.itens[0].codigo, "RLV-MIC-02")
  assert.match(requests.find((request) => request.path === "/Api/v3/pedidos/vendas").search, /numerosLojas/)
})

test("reuses a sale already found by the PagBank order id", async () => {
  await withEnvironment(blingEnvironment, async () => {
    const result = await syncPaidOrderToBling(paidOrder, {
      prisma: {
        blingCredential: {
          findUnique: async () => ({
            accessToken: "access-test",
            refreshToken: "refresh-test",
            expiresAt: new Date(Date.now() + 60 * 60 * 1000)
          })
        }
      },
      fetch: async (url, options) => {
        assert.equal(options.method, "GET")
        assert.match(url, /numerosLojas/)
        return response({ data: [{ id: 77, numeroLoja: "PAG-123" }] })
      }
    })

    assert.deepEqual(result, { synced: true, id: 77, existing: true })
  })
})