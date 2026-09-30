import dotenv from "dotenv"
import fastify from "fastify"
import fastifyStatic from "@fastify/static"
import fastifyCors from "@fastify/cors"
import fastifyCookie from "@fastify/cookie"
import fastifyJwt from "@fastify/jwt"
import fastifyRateLimit from "@fastify/rate-limit"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import router from "./router/router.js"
import expedicaoRoutes from "./routes/expedicao.routes.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, "config/.env") })
dotenv.config()

let jwtSecret = process.env.JWT_SECRET || process.env.COOKIE_SECRET
if (!jwtSecret && process.env.NODE_ENV !== "production") {
    jwtSecret = randomBytes(48).toString("base64url")
    console.warn("JWT_SECRET ausente: chave temporária gerada para desenvolvimento; sessões serão encerradas ao reiniciar o servidor.")
}

if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("Configure JWT_SECRET com pelo menos 32 caracteres no ambiente de produção.")
}

const frontendDistDir = join(__dirname, "../frontend/dist")

const server = fastify({ logger: false })

server.register(fastifyCookie, {
    hook: "onRequest"
})

server.register(fastifyJwt, {
    secret: jwtSecret,
    sign: { expiresIn: "12h" }
})

server.register(fastifyRateLimit, {
    global: false
})

server.register(fastifyCors, {
    origin: process.env.FRONTEND_ORIGIN ? [process.env.FRONTEND_ORIGIN] : false,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
})

server.register(fastifyStatic, {
    root: frontendDistDir,
    prefix: "/",
    decorateReply: true
})

server.register(router)
server.register(expedicaoRoutes)

server.get("/", async (_request, reply) => {
    return reply.sendFile("index.html")
})

server.get("/api/health", async () => {
    return {
        status: "ok"
    }
})

server.setNotFoundHandler((request, reply) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
        return reply.code(404).send({
            success: false,
            message: "Rota não encontrada"
        })
    }

    if (request.raw.url?.startsWith("/api/")) {
        return reply.code(404).send({
            success: false,
            message: "Rota de API não encontrada"
        })
    }

    return reply.sendFile("index.html")
})

const port = Number(process.env.PORT || 3001)
const host = process.env.HOST || "0.0.0.0"

server.listen({ port, host }, (err, address) => {
    if (err) {
        console.error(err)
        process.exit(1)
    }
    console.log(`Server listening on ${address}`)
})