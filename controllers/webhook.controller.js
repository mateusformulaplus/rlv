import { getPagBankOrder } from "../services/pagbank.service.js"
import { findOrderByPagBankId, fulfillPaidOrder, saveOrder } from "../services/order.service.js"

export async function handlePagBankWebhook(payload, dependencies = {}) {
	const findOrder = dependencies.findOrderByPagBankId || findOrderByPagBankId
	const fetchPagBankOrder = dependencies.getPagBankOrder || getPagBankOrder
	const persistOrder = dependencies.saveOrder || saveOrder
	const fulfillOrder = dependencies.fulfillPaidOrder || fulfillPaidOrder
	const pagbankOrderId = payload?.id
	if (!pagbankOrderId) throw new Error("Webhook PagBank sem identificador do pedido")

	const localOrder = await findOrder(pagbankOrderId)
	if (!localOrder) throw new Error("Pedido PagBank não encontrado localmente")

	const pagbankOrder = await fetchPagBankOrder(pagbankOrderId)
	const isPaid = pagbankOrder.charges?.some((charge) => charge.status === "PAID")
	if (!isPaid) {
		await persistOrder({ ...localOrder, status: pagbankOrder.charges?.[0]?.status?.toLowerCase() || "payment_pending" })
		return { status: "ignored", paymentStatus: pagbankOrder.charges?.[0]?.status || "UNKNOWN" }
	}

	const paidOrder = await persistOrder({ ...localOrder, status: "paid", pagbank: pagbankOrder })
	let fulfilledOrder
	try {
		fulfilledOrder = await fulfillOrder(paidOrder)
	} catch (error) {
		console.error(`[PagBank] Pagamento ${pagbankOrderId} confirmado; falha ao processar expedição:`, error.message)
		return {
			status: "paid",
			fulfillmentStatus: "pending",
			trackingCode: paidOrder.trackingCode || null,
			label: paidOrder.melhorEnvioLabel || null
		}
	}

	return {
		status: fulfilledOrder.status,
		trackingCode: fulfilledOrder.trackingCode,
		label: fulfilledOrder.melhorEnvioLabel
	}
}
