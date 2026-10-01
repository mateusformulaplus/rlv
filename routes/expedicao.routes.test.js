import assert from "node:assert/strict"
import test from "node:test"
import Fastify from "fastify"
import cookie from "@fastify/cookie"
import jwt from "@fastify/jwt"
import rateLimit from "@fastify/rate-limit"
import bcrypt from "bcryptjs"

test("protects expedition routes with an HttpOnly JWT cookie", async () => {
  const { default: expedicaoRoutes } = await import("./expedicao.routes.js")
  const app = Fastify()
  const passwordHash = await bcrypt.hash("test-expedition-password", 4)
  const adminUser = {
    id: "test-user-id",
    username: "test-expedition-user",
    displayName: "Test Admin",
    passwordHash,
    role: "admin",
    active: true,
    lastLoginAt: null,
    createdAt: new Date()
  }
  const userRepository = {
    findByUsername: async (username) => username === adminUser.username ? adminUser : null,
    findById: async (id) => id === adminUser.id ? adminUser : null,
    update: async (_id, changes) => Object.assign(adminUser, changes)
  }

  app.register(cookie)
  app.register(jwt, {
    secret: "test-jwt-secret-with-at-least-32-characters",
    sign: { expiresIn: "12h" }
  })
  app.register(rateLimit, { global: false })
  app.register(expedicaoRoutes, { userRepository })

  try {
    await app.ready()

    const anonymousResponse = await app.inject({
      method: "GET",
      url: "/api/expedicao/pedidos"
    })
    assert.equal(anonymousResponse.statusCode, 401)

    const directDashboardResponse = await app.inject({
      method: "GET",
      url: "/frontend/expedicao/dashboard.html"
    })
    assert.equal(directDashboardResponse.statusCode, 401)

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/expedicao/login",
      payload: {
        username: adminUser.username.toUpperCase(),
        password: "test-expedition-password"
      }
    })
    assert.equal(loginResponse.statusCode, 200)

    const setCookie = loginResponse.headers["set-cookie"]
    assert.match(setCookie, /HttpOnly/i)
    assert.match(setCookie, /SameSite=Strict/i)

    const token = setCookie.split(";")[0].slice("expedicao_token=".length)
    assert.equal(token.split(".").length, 3)

    const authenticatedResponse = await app.inject({
      method: "GET",
      url: "/api/expedicao/me",
      headers: { cookie: `expedicao_token=${token}` }
    })
    assert.equal(authenticatedResponse.json().authenticated, true)
    assert.equal(authenticatedResponse.json().user.username, adminUser.username)
    assert.equal(authenticatedResponse.json().user.passwordHash, undefined)

    const invalidTokenResponse = await app.inject({
      method: "GET",
      url: "/api/expedicao/pedidos",
      headers: { cookie: "expedicao_token=invalid-token" }
    })
    assert.equal(invalidTokenResponse.statusCode, 401)

    const legacyPassword = "legacy-plain-text-password"
    adminUser.passwordHash = legacyPassword
    const legacyLoginResponse = await app.inject({
      method: "POST",
      url: "/api/expedicao/login",
      payload: { username: adminUser.username, password: legacyPassword }
    })
    assert.equal(legacyLoginResponse.statusCode, 200)
    assert.notEqual(adminUser.passwordHash, legacyPassword)
    assert.equal(await bcrypt.compare(legacyPassword, adminUser.passwordHash), true)
  } finally {
    await app.close()
  }
})
