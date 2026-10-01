import { getPrismaClient } from "./prisma.js"
import { correctLegacyPackageWeight } from "../services/shipping.service.js"

const DEFAULT_PAGE_SIZE = Number(process.env.EXPEDICAO_PAGE_SIZE || 5)

function normalizeString(value, fallback = "") {
  if (value === undefined || value === null) return fallback
  return String(value).trim() || fallback
}

function normalizePedido(payload = {}) {
  const source = payload?.pedido || payload || {}
  const cliente = source.cliente || source.customer || {}
  const endereco = source.endereco || source.address || {}
  const produto = source.produto || source.product || {}

  const codigoPedido = normalizeString(
    source.codigoPedido || source.codigo || source.transactionId || source.referenceId || payload?.codigoPedido || payload?.referenceId,
    `PED-${Date.now()}`
  )

  const statusPagamento = normalizeString(
    source.statusPagamento || source.paymentStatus || payload?.statusPagamento || payload?.paymentStatus,
    "Pendente"
  )

  const enderecoCompleto = normalizeString(
    endereco.completo || `${endereco.rua || "Rua não informada"}, ${endereco.numero || "S/N"} - ${endereco.bairro || "Bairro não informado"}, ${endereco.cidade || "Cidade não informada"}/${endereco.estado || "SP"} - ${endereco.cep || "00000-000"}`,
    "Endereço não informado"
  )

  return {
    codigoPedido,
    pagbankOrderId: normalizeString(
      source.pagbankOrderId || source.pagbankOrderID || payload?.pagbankOrderId || payload?.pagbankOrderID || codigoPedido,
      codigoPedido
    ),
    statusPagamento: statusPagamento === "Pago" ? "Pago" : "Pendente",
    clienteNome: normalizeString(cliente.nome || cliente.name, "Cliente sem nome"),
    clienteTelefone: normalizeString(cliente.telefone || cliente.phone || cliente.mobile, "Telefone não informado"),
    clienteEmail: normalizeString(cliente.email, ""),
    produtoNome: normalizeString(produto.nome || produto.name || produto.productName, "Produto sem nome"),
    produtoQuantidade: Number(produto.quantidade || produto.quantity || payload?.quantidade || 1),
    enderecoRua: normalizeString(endereco.rua || endereco.street || endereco.logradouro, "Rua não informada"),
    enderecoNumero: normalizeString(endereco.numero || endereco.number || endereco.numeroCasa, "S/N"),
    enderecoBairro: normalizeString(endereco.bairro || endereco.neighborhood || endereco.district, "Bairro não informado"),
    enderecoCidade: normalizeString(endereco.cidade || endereco.city, "Cidade não informada"),
    enderecoEstado: normalizeString(endereco.estado || endereco.state || endereco.state_abbr, "SP"),
    enderecoCep: normalizeString(endereco.cep || endereco.postal_code || endereco.zipCode, "00000-000"),
    frete: normalizeString(source.frete || source.shippingType || source.type || payload?.frete || payload?.shippingType || payload?.type, "Não informado"),
    peso: normalizeString(produto.peso || produto.weight, "0 kg"),
    dimensoes: normalizeString(produto.dimensoes || produto.dimensions, "Não informado"),
    enderecoCompleto,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}

function toPedidoView(record) {
  if (!record) return null

  return {
    id: record.id,
    codigoPedido: record.codigoPedido,
    pagbankOrderId: record.pagbankOrderId,
    statusPagamento: record.statusPagamento,
    cliente: {
      nome: record.clienteNome,
      telefone: record.clienteTelefone,
      email: record.clienteEmail
    },
    telefone: record.clienteTelefone,
    produto: record.produtoNome,
    quantidade: record.produtoQuantidade,
    endereco: {
      rua: record.enderecoRua,
      numero: record.enderecoNumero,
      bairro: record.enderecoBairro,
      cidade: record.enderecoCidade,
      estado: record.enderecoEstado,
      cep: record.enderecoCep,
      completo: record.enderecoCompleto || `${record.enderecoRua}, ${record.enderecoNumero} - ${record.enderecoBairro}, ${record.enderecoCidade}/${record.enderecoEstado} - ${record.enderecoCep}`
    },
    frete: record.frete,
    valorFrete: record.valorFrete || 0,
    statusExpedicao: record.statusExpedicao || "Aguardando pagamento",
    codigoRastreio: record.codigoRastreio || null,
    etiquetaDisponivel: Boolean(record.etiquetaDisponivel),
    peso: correctLegacyPackageWeight(record.peso, record.produtoQuantidade || 1),
    dimensoes: record.dimensoes,
    createdAt: record.createdAt ? new Date(record.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : new Date().toISOString()
  }
}

export async function listPedidos({ search = "", page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const safePage = Math.max(1, Number(page) || 1)
  const safePageSize = Math.max(1, Math.min(50, Number(pageSize) || DEFAULT_PAGE_SIZE))
  const searchTerm = String(search || "").trim()

  const where = searchTerm
    ? {
        OR: [
          { codigoPedido: { contains: searchTerm, mode: "insensitive" } },
          { clienteNome: { contains: searchTerm, mode: "insensitive" } },
          { produtoNome: { contains: searchTerm, mode: "insensitive" } },
          { enderecoCompleto: { contains: searchTerm, mode: "insensitive" } }
        ]
      }
    : {}

  const [records, total] = await Promise.all([
    getPrismaClient().expedicaoPedido.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize
    }),
    getPrismaClient().expedicaoPedido.count({ where })
  ])

  return {
    pedidos: records.map(toPedidoView).filter(Boolean),
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / safePageSize))
  }
}

export async function getExpedicaoSummary() {
  const prisma = getPrismaClient()
  const [total, pagos, pendentes, recentRecords] = await Promise.all([
    prisma.expedicaoPedido.count(),
    prisma.expedicaoPedido.count({ where: { statusPagamento: "Pago" } }),
    prisma.expedicaoPedido.count({ where: { statusPagamento: "Pendente" } }),
    prisma.expedicaoPedido.findMany({ orderBy: { createdAt: "desc" }, take: 5 })
  ])

  return {
    total,
    pagos,
    pendentes,
    recentes: recentRecords.map(toPedidoView).filter(Boolean)
  }
}

export async function markPedidoAsSent(pagbankOrderId, prisma = getPrismaClient()) {
  const pedido = await prisma.expedicaoPedido.findUnique({ where: { pagbankOrderId } })
  if (!pedido) return null
  if (pedido.statusPagamento !== "Pago") {
    return { updated: false, pedido: toPedidoView(pedido) }
  }

  const updated = await prisma.expedicaoPedido.update({
    where: { id: pedido.id },
    data: { statusExpedicao: "Enviado" }
  })
  return { updated: true, pedido: toPedidoView(updated) }
}

export async function findPedidoByPagBankId(pagbankOrderId) {
  const record = await getPrismaClient().expedicaoPedido.findUnique({ where: { pagbankOrderId } })
  return toPedidoView(record)
}

export async function savePedidoWebhook(payload = {}) {
  const pedido = normalizePedido(payload)
  const record = await getPrismaClient().expedicaoPedido.upsert({
    where: { codigoPedido: pedido.codigoPedido },
    create: {
      codigoPedido: pedido.codigoPedido,
      pagbankOrderId: pedido.pagbankOrderId,
      statusPagamento: pedido.statusPagamento,
      clienteNome: pedido.clienteNome,
      clienteTelefone: pedido.clienteTelefone,
      clienteEmail: pedido.clienteEmail,
      produtoNome: pedido.produtoNome,
      produtoQuantidade: pedido.produtoQuantidade,
      enderecoRua: pedido.enderecoRua,
      enderecoNumero: pedido.enderecoNumero,
      enderecoBairro: pedido.enderecoBairro,
      enderecoCidade: pedido.enderecoCidade,
      enderecoEstado: pedido.enderecoEstado,
      enderecoCep: pedido.enderecoCep,
      frete: pedido.frete,
      peso: pedido.peso,
      dimensoes: pedido.dimensoes,
      enderecoCompleto: pedido.enderecoCompleto
    },
    update: {
      pagbankOrderId: pedido.pagbankOrderId,
      statusPagamento: pedido.statusPagamento,
      clienteNome: pedido.clienteNome,
      clienteTelefone: pedido.clienteTelefone,
      clienteEmail: pedido.clienteEmail,
      produtoNome: pedido.produtoNome,
      produtoQuantidade: pedido.produtoQuantidade,
      enderecoRua: pedido.enderecoRua,
      enderecoNumero: pedido.enderecoNumero,
      enderecoBairro: pedido.enderecoBairro,
      enderecoCidade: pedido.enderecoCidade,
      enderecoEstado: pedido.enderecoEstado,
      enderecoCep: pedido.enderecoCep,
      frete: pedido.frete,
      peso: pedido.peso,
      dimensoes: pedido.dimensoes,
      enderecoCompleto: pedido.enderecoCompleto
    }
  })

  return toPedidoView(record)
}
