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
    clientId: process.env.BLING_CLIENT_ID || "f6c0c5c396f775ebf8d818376980c38d1362bbc2",
    clientSecret: process.env.BLING_CLIENT_SECRET || "8646e601b64a422573044b29cfef117cf9ae4cc83856c7550890b6c8cbda",
    redirectUri: process.env.BLING_REDIRECT_URI || "https://rlv-ttmm.onrender.com/api/bling/callback"
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

async function blingRequest(path, { token, method = "GET", body, fetchImpl, retries = 2 }) {
  const fetchFn = fetchImpl || fetch
  const url = `${API_URL}${path}`
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchFn(url, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
      if (response.status === 429 && attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
        continue
      }
      return await parseResponse(response, `Falha na API do Bling (${method} ${path}).`)
    } catch (error) {
      const isRateLimit = error.message?.includes("limite de requisições") || error.message?.includes("429")
      if (isRateLimit && attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
        continue
      }
      throw error
    }
  }
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
    } else if (method === "CREDIT_CARD") {
      matched = forms.find((f) => f.situacao === 1 && (f.tipoPagamento === 3 || /cr.dito/i.test(f.descricao)))
        || forms.find((f) => f.situacao === 1 && (/cart.o/i.test(f.descricao)))
    } else if (method === "DEBIT_CARD") {
      matched = forms.find((f) => f.situacao === 1 && (f.tipoPagamento === 4 || /d.bito/i.test(f.descricao)))
        || forms.find((f) => f.situacao === 1 && (/cart.o/i.test(f.descricao)))
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
  // packageWeightKg mantido para compatibilidade — calculado mais abaixo com os dados do volume

  const charge = order.pagbank?.charges?.find((c) => c.status === "PAID") || order.pagbank?.charges?.[0] || {}
  const paymentMethod = charge.payment_method || {}
  const methodType = String(paymentMethod.type || order.paymentMethod || "").toUpperCase()
  const installmentsCount = Math.max(1, Number(paymentMethod.installments || order.installments || 1))

  const total = Number((amount + shippingAmount).toFixed(2))

  let parcelas = []
  if (paymentFormId) {
    if (methodType === "CREDIT_CARD" && installmentsCount > 1) {
      const baseValue = Math.floor((total / installmentsCount) * 100) / 100
      const diff = Number((total - (baseValue * installmentsCount)).toFixed(2))

      const baseDate = new Date(today + "T12:00:00Z")
      for (let i = 0; i < installmentsCount; i++) {
        const dueDate = new Date(baseDate)
        dueDate.setMonth(dueDate.getMonth() + i)
        const valorParcela = i === 0 ? Number((baseValue + diff).toFixed(2)) : baseValue

        parcelas.push({
          dataVencimento: dueDate.toISOString().slice(0, 10),
          valor: valorParcela,
          formaPagamento: { id: Number(paymentFormId) },
          observacoes: `Cartão de Crédito - Parcela ${i + 1}/${installmentsCount}`
        })
      }
    } else {
      let desc = "Pago via PagBank"
      if (methodType === "PIX") desc = "Pago via Pix"
      else if (methodType === "CREDIT_CARD") desc = "Cartão de Crédito (1x)"
      else if (methodType === "DEBIT_CARD") desc = "Cartão de Débito"

      parcelas.push({
        dataVencimento: today,
        valor: total,
        formaPagamento: { id: Number(paymentFormId) },
        observacoes: desc
      })
    }
  }

  let paymentMethodLabel = "Outro"
  if (methodType === "PIX") paymentMethodLabel = "Pix"
  else if (methodType === "CREDIT_CARD") paymentMethodLabel = installmentsCount > 1 ? `Cartão de Crédito (${installmentsCount}x)` : "Cartão de Crédito (1x)"
  else if (methodType === "DEBIT_CARD") paymentMethodLabel = "Cartão de Débito"

  const shipping = order.shipping || {}
  const shippingAddress = shipping.to || {}
  const shippingVolume = shipping.volumes?.[0] || {}
  const shippingServiceName = shipping.serviceName
    || (shipping.service ? `Serviço ${shipping.service}` : "")
  const trackingCode = order.trackingCode || order.tracking?.tracking || order.tracking?.tracking_code || null
  const carrierName = shipping.company?.name
    || (typeof shipping.company === "string" ? shipping.company : null)
    || (shippingServiceName.includes(" - ") ? shippingServiceName.split(" - ")[0].trim() : (shippingServiceName || null))

  // Dimensões do pacote (cm) — enviadas DIRETO no objeto volume (API v3 Bling não aceita objeto aninhado 'dimensoes')
  const largura = Number(shippingVolume.width || shippingVolume.largura || 12)
  const altura = Number(shippingVolume.height || shippingVolume.altura || 18)
  const comprimento = Number(shippingVolume.length || shippingVolume.comprimento || shippingVolume.depth || 2)
  const pesoBruto = Number(shippingVolume.weight || 0) || Number((0.0211 * Number(product.quantity || 1)).toFixed(4))
  const valorDeclarado = Number(shipping.insuranceValue || amount || 0)

  // Volume com todos os campos obrigatórios para cotação e etiqueta no Bling
  const volumeItem = {
    quantidade: 1,
    pesoBruto,
    pesoLiquido: pesoBruto,
    largura,
    altura,
    comprimento,
    ...(valorDeclarado > 0 ? { valorDeclarado } : {}),
    ...(shippingServiceName ? { servico: shippingServiceName } : {}),
    ...(trackingCode ? { codigoRastreamento: trackingCode } : {})
  }

  const shippingDesc = shippingServiceName ? ` | Frete: ${shippingServiceName}` : ""

  // Etiqueta de entrega — necessária para emissão de NF e cotação de volume no Bling
  const etiqueta = {}
  if (shippingAddress.name || order.customer?.name) etiqueta.nome = shippingAddress.name || order.customer?.name
  if (shippingAddress.address || shippingAddress.street) etiqueta.endereco = shippingAddress.address || shippingAddress.street
  if (shippingAddress.number) etiqueta.numero = shippingAddress.number
  if (shippingAddress.complement) etiqueta.complemento = shippingAddress.complement
  if (shippingAddress.district) etiqueta.bairro = shippingAddress.district
  if (shippingAddress.city) etiqueta.municipio = shippingAddress.city
  if (shippingAddress.state_abbr || shippingAddress.state) etiqueta.uf = shippingAddress.state_abbr || shippingAddress.state
  const destCEP = digits(shippingAddress.postal_code || shippingAddress.cep || "")
  if (destCEP) etiqueta.cep = destCEP

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
    ...(shippingServiceName ? { observacoes: `Forma de Envio: ${shippingServiceName}` } : {}),
    observacoesInternas: `Pagamento confirmado pelo PagBank (${paymentMethodLabel}). Pedido: ${order.pagbankOrderId}${shippingDesc}`,
    transporte: {
      fretePorConta: 0,
      frete: shippingAmount,
      quantidadeVolumes: 1,
      pesoBruto,
      ...(carrierName ? { transportador: { nome: carrierName } } : {}),
      ...(Object.keys(etiqueta).length > 0 ? { etiqueta } : {}),
      volumes: [volumeItem]
    },
    ...(parcelas.length > 0 ? { parcelas } : {})
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