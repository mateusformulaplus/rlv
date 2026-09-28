import { findOrderByPagBankId } from "../services/order.service.js"

export async function getOrderStatus(request, reply) {
	const order = await findOrderByPagBankId(request.params.pagbankOrderId)
	if (!order) {
		return reply.code(404).send({ success: false, message: "Pedido não encontrado" })
	}

	return reply.send({
		success: true,
		order: {
			id: order.pagbankOrderId,
			status: order.status,
			trackingCode: order.trackingCode || null,
			label: order.melhorEnvioLabel || null,
			updatedAt: order.updatedAt
		}
	})
}
