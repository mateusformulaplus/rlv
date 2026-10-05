import { randomUUID } from "node:crypto"
import { getPrismaClient } from "../lib/prisma.js"

const API_URL = "https://api.bling.com.br/Api/v3"
const AUTH_URL = "https://www.bling.com.br/Api/v3/oauth/authorize"
const CREDENTIAL_ID = "bling"
const PRODUCT_SKUS_BY_REFERENCE = {
  "kit-1": "RLV-MIC-01",
  "kit-2": "RLV-MIC-02",
  "kit-3": "RLV-MIC-03",
  "kit-4": "RLV-MIC-06"
}

function getBlingAppConfig() {
  return {
    clientId: process.env.BLING_CLIENT_ID || "",
    clientSecret: process.env.BLING_CLIENT_SECRET || "",
    redirectUri: process.env.BLING_REDIRECT_URI || ""
  }
}

function requireBlingAppConfig() {
  const config = getBlingAppConfig()
  if (Object.values(config).some((value) => !value.trim())) {
    throw new Error("Configure BLING_CLIENT_ID, BLING_CLIENT_SECRET e BLING_REDIRECT_URI.")
  }
  return config
}

function responseError(data, fallback) {
  return data?.error?.description
    || data?.error?.message
    || data?.message
    || data?.error
    || fallback
}

async function parseResponse(response, fallback) {
  const text = await response.text()
  let data = {}
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { message: text }
    }
  }
  if (!response.ok) throw new Error(responseError(data, fallback))
  return data
}

async function exchangeToken(form, fetchImpl = fetch) {
  const { clientId, clientSecret } = requireBlingAppConfig()
  const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
  const response = await fetchImpl(`${API_URL}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  })
  return parseResponse(response, "Não foi possível obter o token do Bling.")
}

async function saveCredential(tokens, prisma) {
  const expiresAt = Number(tokens.expires_in) > 0
    ? new Date(Date.now() + Number(tokens.expires_in) * 1000)
    : null
  return prisma.blingCredential.upsert({
    where: { id: CREDENTIAL_ID },
    create: {
      id: CREDENTIAL_ID,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt
    },
    update: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt
    }
  })
}

export async function createBlingAuthorizationUrl(prisma = getPrismaClient()) {
  const { clientId, redirectUri } = requireBlingAppConfig()
  const state = randomUUID()
  await prisma.blingOAuthState.create({
    data: { state, expiresAt: new Date(Date.now() + 10 * 60 * 1000) }
  })

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state
  })
  return `${AUTH_URL}?${params.toString()}`
}

export async function completeBlingAuthorization(code, state, dependencies = {}) {
  if (!code || !state) throw new Error("Código ou state do Bling ausente.")
  const prisma = dependencies.prisma || getPrismaClient()
  const savedState = await prisma.blingOAuthState.findUnique({ where: { state } })
  if (!savedState || savedState.expiresAt <= new Date()) {
    throw new Error("State de autorização do Bling inválido ou expirado. Inicie a autorização novamente.")
  }
  await prisma.blingOAuthState.delete({ where: { state } })

  const { redirectUri } = requireBlingAppConfig()
  const tokens = await exchangeToken(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
  }), dependencies.fetch || fetch)
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("O Bling não retornou os tokens necessários.")
  }
  await saveCredential(tokens, prisma)
  return { connected: true }
}

async function getAccessToken(prisma, fetchImpl) {
  const credential = await prisma.blingCredential.findUnique({ where: { id: CREDENTIAL_ID } })
  if (!credential) throw new Error("Autorize o Bling antes de sincronizar pedidos.")

  if (credential.expiresAt && credential.expiresAt.getTime() > Date.now() + 60_000) {
    return credential.accessToken
  }

  const tokens = await exchangeToken(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: credential.refreshToken
  }), fetchImpl)
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("O Bling não retornou tokens válidos na renovação.")
  }
  await saveCredential(tokens, prisma)
  return tokens.access_token
}

async function blingRequest(path, { token, method = "GET", body, fetchImpl }) {
  const response = await fetchImpl(`${API_URL}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  return parseResponse(response, `Falha na API do Bling (${method} ${path}).`)
}

function digits(value) {
  return String(value || "").replace(/\D/g, "")
}

async function findOrCreateContact(order, token, fetchImpl) {
  const customer = order.customer || {}
  const taxId = digits(customer.taxId || customer.tax_id)
  if (!taxId) throw new Error("Pedido sem CPF/CNPJ para criar contato no Bling.")

  const query = new URLSearchParams({ numeroDocumento: taxId, criterio: "1" })
  const result = await blingRequest(`/contatos?${query}`, { token, fetchImpl })
  const existing = (result.data || []).find((contact) => digits(contact.numeroDocumento) === taxId)
  if (existing?.id) return existing.id

  const shippingAddress = order.shipping?.to || {}
  const personType = taxId.length === 14 ? "J" : "F"
  const payload = {
    nome: customer.name || shippingAddress.name || "Cliente PagBank",
    tipo: personType,
    situacao: "A",
    numeroDocumento: taxId,
    email: customer.email,
    celular: customer.phone || customer.mobile,
    endereco: {
      geral: {
        endereco: shippingAddress.address || shippingAddress.street || "",
        numero: shippingAddress.number || "S/N",
        complemento: shippingAddress.complement || "",
        bairro: shippingAddress.district || "",
        municipio: shippingAddress.city || "",
        uf: shippingAddress.state_abbr || shippingAddress.state || "",
        cep: digits(shippingAddress.postal_code || shippingAddress.cep)
      }
    }
  }
  const created = await blingRequest("/contatos", { token, method: "POST", body: payload, fetchImpl })
  const contactId = created.data?.id
  if (!contactId) throw new Error("O Bling criou o contato sem retornar o ID.")
  return contactId
}

function paymentType(order) {
  const method = String(
    order.pagbank?.charges?.find((charge) => charge.status === "PAID")?.payment_method?.type
      || order.paymentMethod
      || ""
  ).toUpperCase()
  if (method === "PIX") return 20
  if (method === "CREDIT_CARD") return 3
  if (method === "DEBIT_CARD") return 4
  return 99
}

async function findPaymentForm(order, token, fetchImpl) {
  try {
    const result = await blingRequest("/formas-pagamentos", { token, fetchImpl })
    const forms = result.data || []
    if (!forms.length) return null

    const method = String(
      order.pagbank?.charges?.find((charge) => charge.status === "PAID")?.payment_method?.type
        || order.paymentMethod
        || ""
    ).toUpperCase()

    let matched = null
    if (method === "PIX") {
      matched = forms.find((f) => f.situacao === 1 && (f.tipoPagamento === 20 || f.tipoPagamento === 17 || /pix/i.test(f.descricao)))
    } else if (method === "CREDIT_CARD" || method === "DEBIT_CARD") {
      matched = forms.find((f) => f.situacao === 1 && (f.tipoPagamento === 3 || f.tipoPagamento === 4 || /cart.o|cr.dito|d.bito/i.test(f.descricao)))
    }

    if (!matched) {
      matched = forms.find((f) => f.situacao === 1 && f.padrao === 1)
        || forms.find((f) => f.situacao === 1)
        || forms[0]
    }

    return matched?.id || null
  } catch (error) {
    console.warn(`[Bling] Não foi possível obter forma de pagamento: ${error.message}`)
    return null
  }
}

async function findBlingProduct(order, token, fetchImpl) {
  const referenceId = String(order.referenceId || "").toLowerCase()
  const sku = PRODUCT_SKUS_BY_REFERENCE[referenceId]
  if (!sku) return null

  try {
    const query = new URLSearchParams({ tipo: "P", criterio: "2" })
    query.append("codigos[]", sku)
    const result = await blingRequest(`/produtos?${query}`, { token, fetchImpl })
    const product = (result.data || []).find((item) => String(item.codigo).toUpperCase() === sku)
    if (product?.id) return { id: product.id, sku }
  } catch (error) {
    console.warn(`[Bling] SKU ${sku} não encontrado no cadastro do Bling: ${error.message}`)
  }
  return null
}

export function buildBlingSalesOrderPayload(order, contactId, paymentFormId, today = new Date().toISOString().slice(0, 10), blingProduct = null) {
  const product = order.product || {}
  const amount = Number(product.amount || order.amount || 0)
  const shippingAmount = Number(order.shippingAmount || 0)
  const description = String(product.name || order.productName || "Produto PagBank")
  const packageWeightKg = Number(order.shipping?.volumes?.[0]?.weight || 0)

  return {
    numeroLoja: String(order.pagbankOrderId),
    data: today,
    dataPrevista: today,
    dataSaida: today,
    contato: { id: Number(contactId) },
    itens: [{
      descricao: description,
      quantidade: 1,
      valor: amount,
      valorLista: amount,
      unidade: "UN",
      ...(blingProduct ? { codigo: blingProduct.sku, produto: { id: Number(blingProduct.id) } } : {})
    }],
    observacoesInternas: `Pagamento confirmado pelo PagBank. Pedido: ${order.pagbankOrderId}`,
    transporte: {
      fretePorConta: 0,
      frete: shippingAmount,
      quantidadeVolumes: 1,
      ...(packageWeightKg ? { pesoBruto: packageWeightKg } : {})
    },
    ...(paymentFormId ? {
      parcelas: [{
        dataVencimento: today,
        valor: amount + shippingAmount,
        formaPagamento: { id: Number(paymentFormId) },
        observacoes: `Pago via PagBank (${paymentType(order)}).`
      }]
    } : {})
  }
}

async function findExistingSalesOrder(orderId, token, fetchImpl) {
  const query = new URLSearchParams()
  query.append("numerosLojas[]", String(orderId))
  const result = await blingRequest(`/pedidos/vendas?${query}`, { token, fetchImpl })
  return (result.data || []).find((sale) => String(sale.numeroLoja) === String(orderId)) || null
}

export async function syncPaidOrderToBling(order, dependencies = {}) {
  if (order.blingOrderId) return { synced: true, id: order.blingOrderId, existing: true }
  const config = getBlingAppConfig()
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    return { synced: false, reason: "not_configured" }
  }

  const prisma = dependencies.prisma || getPrismaClient()
  const fetchImpl = dependencies.fetch || fetch
  const token = await getAccessToken(prisma, fetchImpl)
  const existing = await findExistingSalesOrder(order.pagbankOrderId, token, fetchImpl)
  if (existing?.id) return { synced: true, id: existing.id, existing: true }

  const contactId = await findOrCreateContact(order, token, fetchImpl)
  const blingProduct = await findBlingProduct(order, token, fetchImpl)
  const paymentFormId = await findPaymentForm(order, token, fetchImpl)
  const payload = buildBlingSalesOrderPayload(order, contactId, paymentFormId, undefined, blingProduct)
  const result = await blingRequest("/pedidos/vendas", { token, method: "POST", body: payload, fetchImpl })
  const id = result.data?.id
  if (!id) throw new Error("O Bling criou a venda sem retornar o ID.")
  return { synced: true, id, existing: false }
}

export async function getBlingConnectionStatus(prisma = getPrismaClient()) {
  const config = getBlingAppConfig()
  const configured = !!(config.clientId && config.clientSecret && config.redirectUri)
  if (!configured) {
    return { connected: false, configured: false, reason: "Credenciais do Bling não configuradas no servidor." }
  }

  const credential = await prisma.blingCredential.findUnique({ where: { id: CREDENTIAL_ID } })
  if (!credential) {
    return { connected: false, configured: true, reason: "Bling não autorizado. Clique em 'Conectar Bling' para autorizar." }
  }

  const expired = credential.expiresAt && credential.expiresAt.getTime() <= Date.now()
  return {
    connected: true,
    configured: true,
    tokenExpired: expired,
    expiresAt: credential.expiresAt,
    reason: expired ? "Token expirado — será renovado automaticamente no próximo pedido." : null
  }
}