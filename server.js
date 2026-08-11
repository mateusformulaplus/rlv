import fastify from "fastify"
import fastifyStatic from "@fastify/static"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import router from "./router/router.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Pasta raiz do projeto (um nível acima de /backend)
const rootDir = join(__dirname, "..")

const server = fastify({ logger: false })

// Serve o index.html e todos os assets estáticos (imagens, etc.)
server.register(fastifyStatic, {
    root: rootDir,
    prefix: "/",
    // Não sobrescreve as rotas de API
    decorateReply: false
})

// Garante que qualquer rota desconhecida retorne o index.html (SPA fallback)
server.setNotFoundHandler((_request, reply) => {
    reply.sendFile("index.html")
})

server.register(router)

const port = Number(process.env.PORT || 3001)
const host = process.env.HOST || "0.0.0.0"

server.listen({ port, host }, (err, address) => {
    if (err) {
        console.error(err)
        process.exit(1)
    }
    console.log(`Server listening on ${address}`)
})