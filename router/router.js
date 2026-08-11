import { createCheckout } from "../services/pagbank.service.js"

export default async function checkoutRoutes(fastify) {
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

