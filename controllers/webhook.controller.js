import { getPagBankOrder } from "../services/pagbank.service.js"
import { findOrderByPagBankId, fulfillPaidOrder, saveOrder } from "../services/order.service.js"

export async function handlePagBankWebhook(payload) {
	const pagbankOrderId = payload?.id
	if (!pagbankOrderId) throw new Error("Webhook PagBank sem identificador do pedido")

	const localOrder = await findOrderByPagBankId(pagbankOrderId)
	if (!localOrder) throw new Error("Pedido PagBank não encontrado localmente")

	const pagbankOrder = await getPagBankOrder(pagbankOrderId)
	const isPaid = pagbankOrder.charges?.some((charge) => charge.status === "PAID")
	if (!isPaid) {
		await saveOrder({ ...localOrder, status: pagbankOrder.charges?.[0]?.status?.toLowerCase() || "payment_pending" })
		return { status: "ignored", paymentStatus: pagbankOrder.charges?.[0]?.status || "UNKNOWN" }
	}

	const paidOrder = await saveOrder({ ...localOrder, status: "paid", pagbank: pagbankOrder })
	const fulfilledOrder = await fulfillPaidOrder(paidOrder)
	return {
		status: fulfilledOrder.status,
		trackingCode: fulfilledOrder.trackingCode,
		label: fulfilledOrder.melhorEnvioLabel
	}
}
