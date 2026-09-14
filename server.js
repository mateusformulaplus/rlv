import fastify from "fastify"
import fastifyStatic from "@fastify/static"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import router from "./router/router.js"

import  fastifyCors  from "@fastify/cors"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)


// Pasta raiz do projeto (um nível acima de /backend)
const rootDir = join(__dirname, "..")

const server = fastify({ logger: false })


server.register(fastifyCors, {
    origin: "*", // Permite todas as origens (substitua por sua origem específica em produção)
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
})

// Serve o index.html e todos os assets estáticos (imagens, etc.)
server.register(fastifyStatic, {
    root: rootDir,
    prefix: "/",
    // Não sobrescreve as rotas de API
    decorateReply: false
})

// Garante que qualquer rota desconhecida retorne o index.html somente para páginas web
// e responda em JSON para chamadas de API desconhecidas.
server.setNotFoundHandler((request, reply) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
        return reply.code(404).send({
            success: false,
            message: "Rota não encontrada"
        })
    }

    return reply.sendFile("index.html")
})

server.register(router)

server.get("/api/health", async () => {
    return {
        status: "ok"
    }
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