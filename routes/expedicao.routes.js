import bcrypt from "bcryptjs"
import { getExpedicaoSummary, listPedidos, savePedidoWebhook } from "../lib/expedicao-store.js"
import { findOrderByPagBankId, syncExistingOrdersToExpedicao } from "../services/order.service.js"
import { userRepository } from "../services/user.service.js"

const SESSION_COOKIE = "expedicao_token"

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt
  }
}

async function getAuthenticatedUser(fastify, request, repository) {
  const token = request.cookies?.[SESSION_COOKIE]
  if (!token) return null

  try {
    const payload = fastify.jwt.verify(token)
    if (!payload.sub) return null
    const user = await repository.findById(payload.sub)
    return user?.active ? user : null
  } catch {
    return null
  }
}

async function requireAuthentication(fastify, request, reply, repository) {
  const user = await getAuthenticatedUser(fastify, request, repository)
  if (user) return user

  reply.clearCookie(SESSION_COOKIE, { path: "/" })
  reply.code(401).send({ success: false, message: "Sessão expirada." })
  return null
}

function validateUserInput({ username, displayName, password, role }) {
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(String(username || ""))) {
    return "Usuário deve ter de 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado)."
  }
  if (String(displayName || "").trim().length < 2 || String(displayName).trim().length > 100) {
    return "Informe um nome de exibição entre 2 e 100 caracteres."
  }
  if (String(password || "").length < 12) {
    return "A senha precisa ter pelo menos 12 caracteres."
  }
  if (!['admin', 'operator'].includes(role)) {
    return "Papel de usuário inválido."
  }
  return null
}

export default async function expedicaoRoutes(fastify, options = {}) {
  const repository = options.userRepository || userRepository

  fastify.get("/login", async (request, reply) => {
    if (await getAuthenticatedUser(fastify, request, repository)) {
      return reply.redirect("/expedicao")
    }

    return reply.sendFile("app.html")
  })

  fastify.get("/expedicao", async (request, reply) => {
    if (!(await getAuthenticatedUser(fastify, request, repository))) {
      return reply.redirect("/login")
    }

    return reply.sendFile("app.html")
  })

  fastify.get("/expedicao/*", async (request, reply) => {
    if (!(await getAuthenticatedUser(fastify, request, repository))) {
      return reply.redirect("/login")
    }
    return reply.sendFile("app.html")
  })

  fastify.get("/frontend/expedicao/dashboard.html", async (request, reply) => {
    if (!(await getAuthenticatedUser(fastify, request, repository))) {
      return reply.code(401).send({ success: false, message: "Autenticação necessária." })
    }

    return reply.sendFile("app.html")
  })

  for (const route of [
    "/checkout",
    "/checkout.html",
    "/sucesso",
    "/sucesso.html",
    "/politica-privacidade",
    "/politica-privacidade.html",
    "/termos-uso",
    "/termos-uso.html"
  ]) {
    fastify.get(route, async (_request, reply) => reply.sendFile("app.html"))
  }

  fastify.post("/api/expedicao/login", {
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }
  }, async (request, reply) => {
    const { username, password } = request.body || {}

    if (!username || !password) {
      return reply.code(400).send({ success: false, message: "Usuário e senha são obrigatórios." })
    }

    const user = await repository.findByUsername(String(username).trim())
    if (!user?.active || !(await bcrypt.compare(String(password), user.passwordHash))) {
      return reply.code(401).send({ success: false, message: "Credenciais inválidas." })
    }

    const token = fastify.jwt.sign({ sub: user.id })
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 12
    })

    const updatedUser = await repository.update(user.id, { lastLoginAt: new Date() })
    return reply.send({ success: true, redirect: "/expedicao/resumo", user: publicUser(updatedUser) })
  })

  fastify.post("/api/expedicao/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" })
    return reply.send({ success: true })
  })

  fastify.get("/api/expedicao/me", async (request, reply) => {
    const user = await getAuthenticatedUser(fastify, request, repository)
    return reply.send({ authenticated: Boolean(user), user: user ? publicUser(user) : null })
  })

  fastify.get("/api/expedicao/pedidos", async (request, reply) => {
    if (!(await requireAuthentication(fastify, request, reply, repository))) return

    const { page, pageSize, search } = request.query || {}
    const result = await listPedidos({
      page: page || 1,
      pageSize: pageSize || 5,
      search: search || ""
    })

    return reply.send({
      success: true,
      pedidos: result.pedidos,
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages
    })
  })

  fastify.get("/api/expedicao/resumo", async (request, reply) => {
    if (!(await requireAuthentication(fastify, request, reply, repository))) return
    return reply.send({ success: true, resumo: await getExpedicaoSummary() })
  })

  fastify.post("/api/expedicao/sincronizar", async (request, reply) => {
    const currentUser = await requireAuthentication(fastify, request, reply, repository)
    if (!currentUser) return
    if (currentUser.role !== "admin") {
      return reply.code(403).send({ success: false, message: "Acesso restrito a administradores." })
    }

    return reply.send({ success: true, resultado: await syncExistingOrdersToExpedicao() })
  })

  fastify.get("/api/expedicao/pedidos/:pagbankOrderId/etiqueta", async (request, reply) => {
    if (!(await requireAuthentication(fastify, request, reply, repository))) return

    const order = await findOrderByPagBankId(request.params.pagbankOrderId)
    const label = order?.melhorEnvioLabel
    if (!label?.data) {
      return reply.code(404).send({ success: false, message: "Etiqueta ainda não disponível." })
    }

    return reply
      .type(label.contentType || "application/pdf")
      .header("Content-Disposition", `inline; filename="etiqueta-${encodeURIComponent(order.pagbankOrderId)}.pdf"`)
      .send(Buffer.from(label.data, "base64"))
  })

  fastify.post("/api/pedidos", async (request, reply) => {
    const payload = request.body || {}
    const pedido = await savePedidoWebhook(payload)
    return reply.send({ success: true, pedido })
  })

  fastify.get("/api/pedidos", async (request, reply) => {
    if (!(await requireAuthentication(fastify, request, reply, repository))) return

    const { page, pageSize, search } = request.query || {}
    const result = await listPedidos({
      page: page || 1,
      pageSize: pageSize || 5,
      search: search || ""
    })

    return reply.send({
      success: true,
      pedidos: result.pedidos,
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages
    })
  })

  fastify.get("/api/expedicao/usuarios", async (request, reply) => {
    const currentUser = await requireAuthentication(fastify, request, reply, repository)
    if (!currentUser) return
    if (currentUser.role !== "admin") {
      return reply.code(403).send({ success: false, message: "Acesso restrito a administradores." })
    }

    return reply.send({ success: true, usuarios: await repository.list() })
  })

  fastify.post("/api/expedicao/usuarios", async (request, reply) => {
    const currentUser = await requireAuthentication(fastify, request, reply, repository)
    if (!currentUser) return
    if (currentUser.role !== "admin") {
      return reply.code(403).send({ success: false, message: "Acesso restrito a administradores." })
    }

    const input = request.body || {}
    const validationError = validateUserInput(input)
    if (validationError) {
      return reply.code(400).send({ success: false, message: validationError })
    }

    try {
      const user = await repository.create({
        username: String(input.username).trim(),
        displayName: String(input.displayName).trim(),
        passwordHash: await bcrypt.hash(String(input.password), 12),
        role: input.role,
        active: true
      })
      return reply.code(201).send({ success: true, usuario: publicUser(user) })
    } catch (error) {
      if (error.code === "P2002") {
        return reply.code(409).send({ success: false, message: "Este nome de usuário já está em uso." })
      }
      throw error
    }
  })

  fastify.patch("/api/expedicao/usuarios/:id", async (request, reply) => {
    const currentUser = await requireAuthentication(fastify, request, reply, repository)
    if (!currentUser) return
    if (currentUser.role !== "admin") {
      return reply.code(403).send({ success: false, message: "Acesso restrito a administradores." })
    }

    const { active } = request.body || {}
    if (typeof active !== "boolean") {
      return reply.code(400).send({ success: false, message: "Informe o estado ativo do usuário." })
    }
    if (request.params.id === currentUser.id && !active) {
      return reply.code(400).send({ success: false, message: "Você não pode desativar seu próprio usuário." })
    }

    const target = await repository.findById(request.params.id)
    if (!target) return reply.code(404).send({ success: false, message: "Usuário não encontrado." })
    if (target.role === "admin" && target.active && !active && await repository.countAdmins() <= 1) {
      return reply.code(400).send({ success: false, message: "O sistema precisa manter ao menos um administrador ativo." })
    }

    return reply.send({ success: true, usuario: publicUser(await repository.update(target.id, { active })) })
  })

  fastify.delete("/api/expedicao/usuarios/:id", async (request, reply) => {
    const currentUser = await requireAuthentication(fastify, request, reply, repository)
    if (!currentUser) return
    if (currentUser.role !== "admin") {
      return reply.code(403).send({ success: false, message: "Acesso restrito a administradores." })
    }
    if (request.params.id === currentUser.id) {
      return reply.code(400).send({ success: false, message: "Você não pode excluir seu próprio usuário." })
    }

    const target = await repository.findById(request.params.id)
    if (!target) return reply.code(404).send({ success: false, message: "Usuário não encontrado." })
    if (target.role === "admin" && target.active && await repository.countAdmins() <= 1) {
      return reply.code(400).send({ success: false, message: "O sistema precisa manter ao menos um administrador ativo." })
    }

    await repository.delete(target.id)
    return reply.send({ success: true })
  })
}
