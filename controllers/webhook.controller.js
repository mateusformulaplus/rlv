import { getPagBankOrder } from "../services/pagbank.service.js"
import { findOrderByPagBankId, fulfillPaidOrder, saveOrder } from "../services/order.service.js"
import { syncPaidOrderToBling } from "../services/bling.service.js"

export async function handlePagBankWebhook(payload, dependencies = {}) {
	const findOrder = dependencies.findOrderByPagBankId || findOrderByPagBankId
	const fetchPagBankOrder = dependencies.getPagBankOrder || getPagBankOrder
	const persistOrder = dependencies.saveOrder || saveOrder
	const fulfillOrder = dependencies.fulfillPaidOrder || fulfillPaidOrder
	const pagbankOrderId = payload?.id
	if (!pagbankOrderId) throw new Error("Webhook PagBank sem identificador do pedido")

	let localOrder = await findOrder(pagbankOrderId)
	const pagbankOrder = await fetchPagBankOrder(pagbankOrderId)

	if (!localOrder) {
		const customer = pagbankOrder.customer ? {
			name: pagbankOrder.customer.name,
			email: pagbankOrder.customer.email,
			taxId: pagbankOrder.customer.tax_id
		} : {}
		const item = pagbankOrder.items?.[0] || {}
		localOrder = {
			pagbankOrderId: pagbankOrder.id,
			referenceId: pagbankOrder.reference_id,
			status: "payment_pending",
			product: {
				name: item.name || "RLV Fórmulas",
				amount: (item.unit_amount || 0) / 100,
				quantity: item.quantity || 1
			},
			customer,
			shipping: pagbankOrder.shipping || {}
		}
	}
	const isPaid = pagbankOrder.charges?.some((charge) => charge.status === "PAID")
	if (!isPaid) {
		await persistOrder({ ...localOrder, status: pagbankOrder.charges?.[0]?.status?.toLowerCase() || "payment_pending" })
		return { status: "ignored", paymentStatus: pagbankOrder.charges?.[0]?.status || "UNKNOWN" }
	}

	let paidOrder = await persistOrder({ ...localOrder, status: "paid", pagbank: pagbankOrder })
	const syncBlingOrder = dependencies.syncPaidOrderToBling || syncPaidOrderToBling
	try {
		const blingResult = await syncBlingOrder(paidOrder)
		if (blingResult?.synced && blingResult.id) {
			paidOrder = await persistOrder({ ...paidOrder, blingOrderId: String(blingResult.id) })
		} else if (blingResult?.reason !== "not_configured") {
			console.warn(`[PagBank] Pedido ${pagbankOrderId} não sincronizado com o Bling: ${blingResult?.reason || "motivo desconhecido"}`)
		}
	} catch (error) {
		console.error(`[PagBank] Pagamento ${pagbankOrderId} confirmado; falha ao sincronizar com o Bling:`, error.message)
	}

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
