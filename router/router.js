import { createCheckout } from "../services/pagbank.service.js"
import {
    calculateMelhorEnvioShipping,
    createMelhorEnvioAuthorizationUrl,
    exchangeMelhorEnvioCode
} from "../services/melhor-envio.service.js"

export default async function checkoutRoutes(fastify) {
    fastify.get("/api/melhor-envio/authorize", async (_request, reply) => {
        try {
            return reply.redirect(createMelhorEnvioAuthorizationUrl())
        } catch (error) {
            return reply.code(500).send({ success: false, message: error.message })
        }
    })

    fastify.get("/api/melhor-envio/callback", async (request, reply) => {
        try {
            const { code, state } = request.query || {}
            const result = await exchangeMelhorEnvioCode(code, state)
            return reply.send({ success: true, message: "Melhor Envio autorizado", ...result })
        } catch (error) {
            return reply.code(400).send({ success: false, message: error.message })
        }
    })

    fastify.post("/api/melhor-envio/calculate", async (request, reply) => {
        try {
            const result = await calculateMelhorEnvioShipping(request.body || {})
            return reply.send({ success: true, result })
        } catch (error) {
            const message = error.response?.data?.message || error.message
            return reply.code(error.response?.status || 400).send({ success: false, message })
        }
    })

    fastify.options("/api/checkout", async (_request, reply) => {
        reply.header("Access-Control-Allow-Origin", "*")
        reply.header("Access-Control-Allow-Methods", "POST, OPTIONS")
        reply.header("Access-Control-Allow-Headers", "Content-Type")
        return reply.code(204).send()
    })

    fastify.post("/api/checkout", async (request, reply) => {
        reply.header("Access-Control-Allow-Origin", "*")
        reply.header("Access-Control-Allow-Methods", "POST, OPTIONS")
        reply.header("Access-Control-Allow-Headers", "Content-Type")

        try {
            const body = request.body || {}
            const checkoutUrl = await createCheckout(body)
            return reply.send({ success: true, checkoutUrl })
        } catch (error) {
            console.error(error)
            return reply.code(500).send({
                success: false,
                message: error.message || "Erro ao criar checkout"
            })
        }
    })

    fastify.get("/health", async (_request, reply) => {
        reply.send({ ok: true })
    })
}

